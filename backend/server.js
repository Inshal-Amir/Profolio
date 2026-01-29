import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";
import crypto from "crypto";
import { OAuth2Client } from "google-auth-library";

dotenv.config();

const app=express();
app.use(cors({origin:true}));
app.use(express.json());

function mustEnv(k){
  if(!process.env[k]) throw new Error(`Missing env: ${k}`);
  return process.env[k];
}

const PORT=process.env.API_PORT||4000;
const FRONTEND_BASE_URL=mustEnv("FRONTEND_BASE_URL");
const N8N_WEBHOOK=mustEnv("N8N_ONBOARDING_WEBHOOK");

// --- Google Config ---
const googleClient=new OAuth2Client(
  mustEnv("GOOGLE_CLIENT_ID"),
  mustEnv("GOOGLE_CLIENT_SECRET"),
  mustEnv("GOOGLE_REDIRECT_URI")
);

// --- Microsoft Config ---
const MS_CLIENT_ID = mustEnv("MICROSOFT_CLIENT_ID");
const MS_CLIENT_SECRET = mustEnv("MICROSOFT_CLIENT_SECRET");
const MS_REDIRECT_URI = mustEnv("MICROSOFT_REDIRECT_URI");

// --- Helper Functions ---
function signState(obj){
  const secret=mustEnv("STATE_HMAC_SECRET");
  const body=Buffer.from(JSON.stringify(obj),"utf8").toString("base64url");
  const sig=crypto.createHmac("sha256",secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verifyState(state){
  const secret=mustEnv("STATE_HMAC_SECRET");
  const parts=(state||"").split(".");
  if(parts.length!==2) return null;
  const body=parts[0];
  const sig=parts[1];
  const expected=crypto.createHmac("sha256",secret).update(body).digest("base64url");
  if(sig!==expected) return null;
  try{
    return JSON.parse(Buffer.from(body,"base64url").toString("utf8"));
  }catch{
    return null;
  }
}

function detectProvider(email) {
  const e = email.toLowerCase();
  if (e.endsWith("@gmail.com") || e.endsWith("@googlemail.com")) return "google";
  if (e.endsWith("@outlook.com") || e.endsWith("@hotmail.com") || e.endsWith("@live.com") || e.endsWith("@office365.com")) return "microsoft";
  return "unknown"; 
}

async function postToN8n(payload){
  await axios.post(N8N_WEBHOOK,payload,{timeout:15000});
}

const onboardingCache=new Map();

setInterval(()=>{
  const now=Date.now();
  for(const [k,v] of onboardingCache.entries()){
    if(!v||!v._created_at_ms) continue;
    if(now-v._created_at_ms>24*60*60*1000) onboardingCache.delete(k);
  }
},60*1000);

app.get("/health",(req,res)=>res.json({ok:true}));

// ------------------------------------------------------------------
// 1. Start: Receive Form Data
// ------------------------------------------------------------------
// ------------------------------------------------------------------
// 1. Start: Receive Form Data (PARTIAL)
// ------------------------------------------------------------------
app.post("/api/onboarding/start",async(req,res)=>{
  try{
    const b=req.body||{};
    const missing=[];

    const company_name=(b.company_name||"").trim();
    const contact_email=(b.contact_email||"").trim();
    const business_type=(b.business_type||"").trim();
    const timezone=(b.timezone||"UTC").trim();
    
    // Arrays
    const monitored_addresses=Array.isArray(b.monitored_addresses)?b.monitored_addresses.map(x=>(x||"").trim()).filter(Boolean):[];
    
    const compliance_accept = !!b.compliance_accept;

    if(!company_name) missing.push("company_name");
    if(!contact_email) missing.push("contact_email");
    if(!business_type) missing.push("business_type");
    if(!compliance_accept) missing.push("compliance_accept");
    if(monitored_addresses.length<1) missing.push("monitored_addresses");

    if(missing.length){
      return res.status(400).json({error:"Missing required fields",missing});
    }

    const org_id=crypto.randomUUID();
    const mailbox_id=crypto.randomUUID();

    const payload={
      org_id,
      mailbox_id,
      company_name,
      contact_email,
      business_type,
      timezone,
      monitored_addresses, 
      pending_emails: [...monitored_addresses],
      connected_emails: [], 
      connections: [], // Store full connection objects
      compliance_accept,
      _created_at_ms:Date.now(),
      // Config placeholders
      default_signals_selected: [],
      alert_channels: [],
      whatsapp_numbers: [],
      slack_webhook_urls: [],
      routing: {},
      digest: {}
    };

    onboardingCache.set(mailbox_id,payload);

    return res.json({org_id,mailbox_id});
  }catch(e){
    return res.status(500).json({error:e.message||"Server error"});
  }
});

// ------------------------------------------------------------------
// 2. DISPATCHER (Modified to redirect back to Frontend Wizard)
// ------------------------------------------------------------------
app.get("/api/oauth/dispatch", (req, res) => {
  const org_id = req.query.org_id;
  const mailbox_id = req.query.mailbox_id;
  if(!org_id || !mailbox_id) return res.status(400).send("Missing IDs");

  const onboarding = onboardingCache.get(mailbox_id);
  // If session lost, redirect to start
  if(!onboarding) return res.redirect(`${FRONTEND_BASE_URL}/onboarding?error=session_expired`);

  if(!onboarding.pending_emails || onboarding.pending_emails.length === 0) {
     // ALL DONE with OAuth
     return res.redirect(`${FRONTEND_BASE_URL}/onboarding?step=4&mailbox_id=${encodeURIComponent(mailbox_id)}`);
  }

  const nextEmail = onboarding.pending_emails[0];
  const provider = detectProvider(nextEmail);
  const qp = `org_id=${encodeURIComponent(org_id)}&mailbox_id=${encodeURIComponent(mailbox_id)}`;

  // Redirect to provider specific start
  if(provider === "google") {
    return res.redirect(`/api/oauth/google/start?${qp}`);
  }
  if(provider === "microsoft") {
    return res.redirect(`/api/oauth/microsoft/start?${qp}`);
  }

  // Fallback UI if provider unknown
  const html = `
    <!DOCTYPE html>
    <html style="font-family:system-ui;text-align:center;padding:40px;">
      <head><title>Connect Inbox</title></head>
      <body>
        <div style="max-width:500px;margin:0 auto;border:1px solid #ddd;padding:30px;border-radius:12px;">
          <h2>Connect Inbox</h2>
          <p style="font-size:16px;color:#555;">
            We need to connect <b>${nextEmail}</b>.<br/>
            Which provider hosts this email?
          </p>
          <div style="display:grid;gap:12px;margin-top:24px;">
            <a href="/api/oauth/google/start?${qp}" style="display:block;padding:12px;text-decoration:none;color:#333;border:1px solid #ccc;border-radius:8px;font-weight:600;">
              Google Workspace (Gmail)
            </a>
            <a href="/api/oauth/microsoft/start?${qp}" style="display:block;padding:12px;text-decoration:none;color:#333;border:1px solid #ccc;border-radius:8px;font-weight:600;">
              Microsoft 365 (Outlook)
            </a>
          </div>
        </div>
      </body>
    </html>
  `;
  res.send(html);
});

// ------------------------------------------------------------------
// 3. FINALIZE: Update Config & Complete
// ------------------------------------------------------------------
app.post("/api/onboarding/finalize", async(req, res) => {
    try {
        const { mailbox_id, config } = req.body;
        if(!mailbox_id) return res.status(400).json({error: "Missing mailbox_id"});

        const onboarding = onboardingCache.get(mailbox_id);
        if(!onboarding) return res.status(400).json({error: "Session expired"});

        // Merge config
        onboarding.default_signals_selected = config.default_signals_selected || [];
        onboarding.alert_channels = config.alert_channels || [];
        onboarding.whatsapp_numbers = config.whatsapp_numbers || [];
        onboarding.whatsapp_consent = !!config.whatsapp_consent;
        onboarding.slack_webhook_urls = config.slack_webhook_urls || [];
        onboarding.routing = config.routing || {};
        onboarding.digest = config.digest || {};

        // Validation for final step could go here if needed
        
        // Prepare N8N payload
        // Prepare Common Config Strings
        const signalsStr = (onboarding.default_signals_selected || []).join(", ");
        const waNumbersStr = (onboarding.whatsapp_numbers || []).join(", ");
        const slackUrlsStr = (onboarding.slack_webhook_urls || []).join(", ");
        const alertChannelsStr = (onboarding.alert_channels || []).join(", ");
        const routingRaw = onboarding.routing || {};
        const routingStr = {
            high: Array.isArray(routingRaw.high) ? routingRaw.high.join(", ") : (routingRaw.high || ""),
            medium: Array.isArray(routingRaw.medium) ? routingRaw.medium.join(", ") : (routingRaw.medium || ""),
            low: routingRaw.low || ""
        };

        // Loop through EACH connected email and fire a separate webhook
        const connections = onboarding.connections || [];
        
        // If no connections (legacy or error), we might still want to send one generic update?
        // But user requirement is "for each monitored email".
        // Let's assume we send one per connection.
        
        for (const [index, conn] of connections.entries()) {
             // Add delay if not the first request (or just always wait to be safe/simple, but "between" usually implies n-1 intervals)
             // However, to ensure rate limiting, waiting before or after is fine. 
             // Request says "add 3 seconds delay between each request".
             if (index > 0) {
                 await new Promise(resolve => setTimeout(resolve, 3000));
             }

             await postToN8n({
                event: `onboarding_and_${conn.provider}_connected`,
                provider: conn.provider,
                org_id: onboarding.org_id,
                mailbox_id: onboarding.mailbox_id,
                company_name: onboarding.company_name,
                contact_email: onboarding.contact_email,
                business_type: onboarding.business_type,
                timezone: onboarding.timezone,
                
                monitored_address: conn.authed_email, 
                
                default_signals_selected: signalsStr,
                alert_channels: alertChannelsStr,
                whatsapp_numbers: waNumbersStr,
                whatsapp_consent: onboarding.whatsapp_consent,
                slack_webhook_urls: slackUrlsStr,
                routing: routingStr,
                digest: onboarding.digest,
                
                authed_email: conn.authed_email,
                tokens: conn.tokens
            });
        }
        
        // If NO connections were made for some reason but we are finalizing?
        // Fallback to sending one config update so N8N knows?
        if (connections.length === 0) {
             await postToN8n({
                event: "onboarding_config_update",
                org_id: onboarding.org_id,
                mailbox_id: onboarding.mailbox_id,
                company_name: onboarding.company_name,
                contact_email: onboarding.contact_email,
                business_type: onboarding.business_type,
                timezone: onboarding.timezone,
                connected_emails: onboarding.connected_emails.join(", "),
                
                default_signals_selected: signalsStr,
                alert_channels: alertChannelsStr,
                whatsapp_numbers: waNumbersStr,
                whatsapp_consent: onboarding.whatsapp_consent,
                slack_webhook_urls: slackUrlsStr,
                routing: routingStr,
                digest: onboarding.digest
             });
        }

        onboardingCache.delete(mailbox_id);
        return res.json({ok:true});

    } catch(e) {
        console.error(e);
        res.status(500).json({error: e.message});
    }
});

// ------------------------------------------------------------------
// 4. OAuth Routes
// ------------------------------------------------------------------
app.get("/api/oauth/google/start",async(req,res)=>{
  try{
    const {org_id, mailbox_id} = req.query;
    const onboarding = onboardingCache.get(mailbox_id);
    if(!onboarding) return res.status(400).send("Session expired");

    const nextEmail = onboarding.pending_emails[0];
    const state=signState({org_id,mailbox_id,provider:"gmail",ts:Date.now()});

    const url=googleClient.generateAuthUrl({
      access_type:"offline",
      prompt:"consent",
      login_hint: nextEmail, 
      scope:[
        "https://www.googleapis.com/auth/gmail.readonly",
        "openid",
        "email"
      ],
      state
    });
    res.redirect(url);
  }catch(e){
    res.status(500).send(e.message);
  }
});

app.get("/api/oauth/google/callback",async(req,res)=>{
  await handleCallback(req, res, "google");
});

app.get("/api/oauth/microsoft/start", (req, res) => {
  try {
    const {org_id, mailbox_id} = req.query;
    const onboarding = onboardingCache.get(mailbox_id);
    if(!onboarding) return res.status(400).send("Session expired");

    const nextEmail = onboarding.pending_emails[0];
    const state = signState({org_id, mailbox_id, provider: "microsoft", ts: Date.now()});

    const params = new URLSearchParams({
      client_id: MS_CLIENT_ID,
      response_type: "code",
      redirect_uri: MS_REDIRECT_URI,
      response_mode: "query",
      scope: "offline_access user.read mail.read openid profile",
      state: state,
      login_hint: nextEmail
    });

    res.redirect(`https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`);
  } catch(e) {
    res.status(500).send(e.message);
  }
});

app.get("/api/oauth/microsoft/callback", async (req, res) => {
  await handleCallback(req, res, "microsoft");
});

// ------------------------------------------------------------------
// 5. Shared Callback Handler
// ------------------------------------------------------------------
async function handleCallback(req, res, providerName) {
  try {
    const code = req.query.code;
    const state = req.query.state;
    if(!code || !state) return res.status(400).send("Missing code/state");

    const st = verifyState(state);
    if(!st || !st.org_id || !st.mailbox_id) return res.status(400).send("Invalid state");

    const {org_id, mailbox_id} = st;
    const onboarding = onboardingCache.get(mailbox_id);
    if(!onboarding) return res.status(400).send("Onboarding expired. Submit form again.");

    let tokens = {};
    let authed_email = "";

    if (providerName === "google") {
      const tokenRes = await googleClient.getToken(code);
      tokens = tokenRes.tokens;
      if(tokens.id_token){
         const ticket = await googleClient.verifyIdToken({
            idToken: tokens.id_token,
            audience: mustEnv("GOOGLE_CLIENT_ID")
         });
         const pl = ticket.getPayload();
         authed_email = pl && pl.email ? pl.email : "";
      }
    } else if (providerName === "microsoft") {
      const params = new URLSearchParams({
        client_id: MS_CLIENT_ID,
        client_secret: MS_CLIENT_SECRET,
        code: code,
        redirect_uri: MS_REDIRECT_URI,
        grant_type: "authorization_code"
      });
      const tr = await axios.post("https://login.microsoftonline.com/common/oauth2/v2.0/token", params.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });
      tokens = {
        access_token: tr.data.access_token,
        refresh_token: tr.data.refresh_token,
        expiry_date: Date.now() + (tr.data.expires_in * 1000),
        scope: tr.data.scope,
        token_type: tr.data.token_type
      };
      const userRes = await axios.get("https://graph.microsoft.com/v1.0/me", {
        headers: { Authorization: `Bearer ${tokens.access_token}` }
      });
      authed_email = userRes.data.mail || userRes.data.userPrincipalName;
    }

    if(onboarding.pending_emails && onboarding.pending_emails.length > 0){
      onboarding.pending_emails.shift();
    }
    
    // Add to connected list
    if(authed_email) {
        onboarding.connected_emails.push(authed_email);
        
        // Store connection details for final batch processing
        if(!onboarding.connections) onboarding.connections = [];
        onboarding.connections.push({
            provider: providerName,
            authed_email: authed_email,
            tokens: tokens
        });
    }

    // Check if more emails pending
    if (onboarding.pending_emails.length > 0) {
        // Next email
        const nextEmail = onboarding.pending_emails[0];
        const nextProvider = detectProvider(nextEmail);
        const qp = `org_id=${encodeURIComponent(org_id)}&mailbox_id=${encodeURIComponent(mailbox_id)}`;
        
         if(nextProvider === "google") {
            return res.redirect(`/api/oauth/google/start?${qp}`);
        }
        if(nextProvider === "microsoft") {
            return res.redirect(`/api/oauth/microsoft/start?${qp}`);
        }
        // If unknown, go to dispatch to ask user
         return res.redirect(`/api/oauth/dispatch?${qp}`);
    } else {
        // ALL DONE -> Return to Frontend Wizard Step 2 (which will auto advance to 3)
         return res.redirect(`${FRONTEND_BASE_URL}/onboarding?step=4&mailbox_id=${encodeURIComponent(mailbox_id)}`);
    }

  } catch(e) {
    console.error(e);
    res.status(500).send("OAuth Callback Error: " + (e.message || e.toString()));
  }
}

app.listen(PORT,()=>console.log(`API running on http://localhost:${PORT}`));