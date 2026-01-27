import React,{useMemo,useState,useEffect} from "react";
import { postJSON,backendRedirectUrl } from "../lib/api.js";

function isEmail(v){
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}
function isE164(v){
  return /^\+[1-9]\d{6,14}$/.test(v.trim());
}
function normWord(s){
  return (s||"").trim().toLowerCase();
}
function dedupeWords(arr){
  const out=[];
  const seen=new Set();
  for(const v of arr){
    const x=normWord(v);
    if(!x) continue;
    if(seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
}

export default function Onboarding(){
  // --- Constants & Config ---
  const presetKeywords=useMemo(()=>[
    "artificial intelligence",
    "late delivery",
    "response time",
    "delay",
    "refund",
    "cancel",
    "complaint",
    "chargeback",
    "review"
  ],[]);

  const businessTypes = [
    { label: "Trades/Services", value: "service" },
    { label: "Ecommerce", value: "ecommerce" },
    { label: "SaaS", value: "saas" },
    { label: "Bookings/Hospitality", value: "bookings_hospitality" }
  ];

  // --- State: Step 1 (Basic Info) ---
  const [company_name,setCompanyName]=useState("");
  const [contact_email,setContactEmail]=useState("");
  const [business_type,setBusinessType]=useState("service");
  const [timezone,setTimezone]=useState("");
  const [compliance_accept,setComplianceAccept]=useState(false);

  // --- State: Step 2 (Monitored Inboxes) ---
  const [monitored_addresses,setMonitoredAddresses]=useState([""]);
  
  // --- State: Step 3 (Signals) ---
  const [selected_keywords,setSelectedKeywords]=useState({});
  const [custom_keyword_input,setCustomKeywordInput]=useState("");
  const [custom_keywords,setCustomKeywords]=useState([]);

  // --- State: Step 4a (Alert Channels) ---
  const [whatsapp_enabled,setWhatsappEnabled]=useState(true);
  const [slack_enabled,setSlackEnabled]=useState(false);
  
  // CHANGED: Now arrays for multiple inputs
  const [whatsapp_numbers,setWhatsappNumbers]=useState([""]); 
  const [slack_urls,setSlackUrls]=useState([""]);

  const [whatsapp_consent,setWhatsappConsent]=useState(false);

  // --- State: Step 4b (Routing) ---
  const [routing_high, setRoutingHigh] = useState(["whatsapp"]); 
  const [routing_medium, setRoutingMedium] = useState(["whatsapp"]);
  const [routing_low, setRoutingLow] = useState("ignore");

  // --- State: Step 4c (Daily Digest) ---
  const [digest_enabled, setDigestEnabled] = useState(true);
  const [digest_recipients, setDigestRecipients] = useState("");
  const [digest_time, setDigestTime] = useState("15:00");

  const [loading,setLoading]=useState(false);
  const [err,setErr]=useState("");

  useEffect(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      setTimezone(tz || "UTC");
    } catch (e) {
      setTimezone("UTC");
    }
  }, []);

  useEffect(() => {
    if(!digest_recipients && contact_email){
        setDigestRecipients(contact_email);
    }
  }, [contact_email]);

  // --- Handlers: Monitored Emails ---
  function setMonitored(i,v){
    setMonitoredAddresses(prev=>{
      const next=[...prev];
      next[i]=v;
      return next;
    });
  }
  function addMonitored(){
    setMonitoredAddresses(prev=> prev.length>=5 ? prev : [...prev,""]);
  }
  function removeMonitored(i){
    setMonitoredAddresses(prev=>{
      const next=prev.filter((_,idx)=>idx!==i);
      return next.length?next:[""];
    });
  }

  // --- Handlers: WhatsApp Numbers (NEW) ---
  function setWaNum(i,v){
    setWhatsappNumbers(prev=>{
      const next=[...prev];
      next[i]=v;
      return next;
    });
  }
  function addWaNum(){
    setWhatsappNumbers(prev=> prev.length>=5 ? prev : [...prev,""]);
  }
  function removeWaNum(i){
    setWhatsappNumbers(prev=>{
      const next=prev.filter((_,idx)=>idx!==i);
      return next.length?next:[""];
    });
  }

  // --- Handlers: Slack URLs (NEW) ---
  function setSlackUrl(i,v){
    setSlackUrls(prev=>{
      const next=[...prev];
      next[i]=v;
      return next;
    });
  }
  function addSlackUrl(){
    setSlackUrls(prev=> prev.length>=5 ? prev : [...prev,""]);
  }
  function removeSlackUrl(i){
    setSlackUrls(prev=>{
      const next=prev.filter((_,idx)=>idx!==i);
      return next.length?next:[""];
    });
  }

  function toggleKeyword(k){
    setSelectedKeywords(prev=>({...prev,[k]:!prev[k]}));
  }

  function addCustomKeyword(){
    const w=normWord(custom_keyword_input);
    if(!w) return;
    setCustomKeywords(prev=>dedupeWords([...prev,w]));
    setCustomKeywordInput("");
  }

  function removeCustomKeyword(w){
    setCustomKeywords(prev=>prev.filter(x=>x!==w));
  }

  function toggleRouting(level, channel) {
    if (level === 'high') {
        setRoutingHigh(prev => prev.includes(channel) ? prev.filter(c => c !== channel) : [...prev, channel]);
    } else if (level === 'medium') {
        setRoutingMedium(prev => prev.includes(channel) ? prev.filter(c => c !== channel) : [...prev, channel]);
    }
  }

  async function submit(e){
    e.preventDefault();
    setErr("");

    const cn=company_name.trim();
    const ce=contact_email.trim();
    const bt=business_type.trim();

    const emails=monitored_addresses.map(x=>x.trim()).filter(x=>x);
    const chosen=presetKeywords.filter(k=>!!selected_keywords[k]);
    const risk_keywords=dedupeWords([...chosen,...custom_keywords]);

    // Filter Alert Inputs
    const valid_wa_numbers = whatsapp_numbers.map(x=>x.trim()).filter(x=>x);
    const valid_slack_urls = slack_urls.map(x=>x.trim()).filter(x=>x);

    const alert_channels=[];
    if(whatsapp_enabled) alert_channels.push("whatsapp");
    if(slack_enabled) alert_channels.push("slack");

    // --- Validation ---
    if(cn.length<2) return setErr("Company name is required.");
    if(!isEmail(ce)) return setErr("Valid work email is required.");
    if(!bt) return setErr("Business type is required.");
    if(!compliance_accept) return setErr("You must accept the Terms & Privacy Policy.");

    if(emails.length<1) return setErr("Add at least 1 monitored email.");
    if(emails.length>5) return setErr("Max 5 monitored emails allowed.");
    for(const a of emails){
      if(!isEmail(a)) return setErr(`Invalid monitored email: ${a}`);
    }

    if(risk_keywords.length<1) return setErr("Select at least 1 risk keyword.");
    if(alert_channels.length<1) return setErr("Select at least one output option (WhatsApp / Slack).");

    if(whatsapp_enabled){
      if(valid_wa_numbers.length < 1) return setErr("Add at least one WhatsApp number.");
      for(const wa of valid_wa_numbers){
        if(!isE164(wa)) return setErr(`Invalid WhatsApp number: ${wa} (Must be E.164)`);
      }
      if(!whatsapp_consent) return setErr("You must consent to receive WhatsApp alerts.");
    }

    if(slack_enabled){
      if(valid_slack_urls.length < 1) return setErr("Add at least one Slack Webhook URL.");
      for(const su of valid_slack_urls){
        if(su.length<10 || !su.startsWith("https://")) return setErr(`Invalid Slack URL: ${su}`);
      }
    }

    if(digest_enabled){
        if(!digest_recipients.trim()) return setErr("Digest recipient(s) required if digest is enabled.");
        const d_emails = digest_recipients.split(',').map(x=>x.trim());
        for(const de of d_emails){
            if(!isEmail(de)) return setErr(`Invalid digest email: ${de}`);
        }
    }

    setLoading(true);
    try{
      const payload={
        company_name:cn,
        contact_email:ce,
        business_type:bt,
        timezone: timezone,
        monitored_addresses:emails,
        default_signals_selected: risk_keywords, 
        alert_channels:alert_channels,
        
        // Send Arrays
        whatsapp_numbers: whatsapp_enabled ? valid_wa_numbers : [],
        whatsapp_consent: whatsapp_enabled ? whatsapp_consent : false,
        slack_webhook_urls: slack_enabled ? valid_slack_urls : [],
        
        routing: {
            high: routing_high,
            medium: routing_medium,
            low: routing_low
        },
        digest: {
            enabled: digest_enabled,
            recipients: digest_recipients,
            time: digest_time
        },
        compliance_accept: compliance_accept
      };

      const out=await postJSON("/onboarding/start",payload);

      if(!out||!out.org_id||!out.mailbox_id) throw new Error("Missing ids from server.");

      const qp=new URLSearchParams({org_id:out.org_id,mailbox_id:out.mailbox_id});
      window.location.href=backendRedirectUrl(`/api/oauth/dispatch?${qp.toString()}`);
    }catch(ex){
      setErr(ex.message||"Failed.");
    }finally{
      setLoading(false);
    }
  }

  return (
    <div style={{maxWidth:720,margin:"30px auto",padding:16,fontFamily:"system-ui"}}>
      <h1 style={{marginBottom:6}}>Mailwise Onboarding</h1>
      <p style={{marginTop:0,opacity:.8}}>Configure your monitoring preferences.</p>

      <form onSubmit={submit} style={{display:"grid",gap:20}}>

        {/* STEP 1: Basic Info */}
        <div style={{border:"1px solid #ddd",borderRadius:10,padding:16}}>
            <h3 style={{marginTop:0}}>Step 1: Basic Info</h3>
            <div style={{display:"grid",gap:14}}>
                <label style={{display:"grid",gap:6}}>
                    <span>Company name</span>
                    <input value={company_name} onChange={e=>setCompanyName(e.target.value)} placeholder="Acme Plumbing Ltd"/>
                </label>
                <label style={{display:"grid",gap:6}}>
                    <span>Work email (Contact)</span>
                    <input value={contact_email} onChange={e=>setContactEmail(e.target.value)} placeholder="name@company.com" type="email"/>
                </label>
                <label style={{display:"grid",gap:6}}>
                    <span>Business type</span>
                    <select value={business_type} onChange={e=>setBusinessType(e.target.value)}>
                        {businessTypes.map(b => (
                            <option key={b.value} value={b.value}>{b.label}</option>
                        ))}
                    </select>
                </label>
                <div style={{fontSize:12, opacity:0.7}}>Timezone detected: {timezone}</div>
            </div>
        </div>

        {/* STEP 2: Monitored Inboxes */}
        <div style={{border:"1px solid #ddd",borderRadius:10,padding:16}}>
          <h3 style={{marginTop:0}}>Step 2: Connect Inbox(es)</h3>
          <div style={{fontSize:13,marginBottom:10,opacity:0.8}}>Add the email addresses (Gmail, Outlook, or Custom Domain) you want to monitor.</div>

          <div style={{display:"grid",gap:10}}>
            {monitored_addresses.map((v,i)=>(
              <div key={i} style={{display:"grid",gridTemplateColumns:"1fr auto",gap:8,alignItems:"center"}}>
                <input value={v} onChange={e=>setMonitored(i,e.target.value)} placeholder="info@abc.io"/>
                <button type="button" onClick={()=>removeMonitored(i)} style={{padding:"8px 10px",borderRadius:10,border:"1px solid #ccc"}}>
                  Remove
                </button>
              </div>
            ))}
          </div>
          <div style={{marginTop:10}}>
            <button type="button" onClick={addMonitored} disabled={monitored_addresses.length>=5}
              style={{padding:"8px 10px",borderRadius:10,border:"1px solid #ccc"}}>
              Add another email
            </button>
          </div>
        </div>

         {/* STEP 3: Signals */}
        <div style={{border:"1px solid #ddd",borderRadius:10,padding:16}}>
          <h3 style={{marginTop:0}}>Step 3: Default Signals</h3>
          <div style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:8}}>
            {presetKeywords.map(k=>(
              <label key={k} style={{display:"flex",gap:10,alignItems:"center"}}>
                <input type="checkbox" checked={!!selected_keywords[k]} onChange={()=>toggleKeyword(k)}/>
                <span>{k}</span>
              </label>
            ))}
          </div>
          <div style={{marginTop:12,display:"grid",gap:8}}>
            <div style={{fontWeight:600,fontSize:13}}>Add custom signal</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:8}}>
              <input value={custom_keyword_input} onChange={e=>setCustomKeywordInput(e.target.value)} placeholder="e.g. missed appointment"/>
              <button type="button" onClick={addCustomKeyword} style={{padding:"8px 10px",borderRadius:10,border:"1px solid #ccc"}}>
                Add
              </button>
            </div>
            {custom_keywords.length?(
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                {custom_keywords.map(w=>(
                  <div key={w} style={{display:"flex",gap:8,alignItems:"center",border:"1px solid #ccc",borderRadius:999,padding:"6px 10px"}}>
                    <span>{w}</span>
                    <button type="button" onClick={()=>removeCustomKeyword(w)} style={{border:"none",background:"transparent",cursor:"pointer"}}>
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            ):null}
          </div>
        </div>

        {/* STEP 4a: Alert Channels */}
        <div style={{border:"1px solid #ddd",borderRadius:10,padding:16}}>
          <h3 style={{marginTop:0}}>Step 4a: Alert Channels</h3>
          
          {/* WhatsApp Section */}
          <label style={{display:"flex",gap:10,alignItems:"center",marginBottom:10}}>
            <input type="checkbox" checked={whatsapp_enabled} onChange={()=>setWhatsappEnabled(v=>!v)}/>
            <span>WhatsApp</span>
          </label>
          {whatsapp_enabled?(
            <div style={{marginLeft:28, marginBottom:20, display:"grid", gap:10}}>
                <div style={{fontWeight:600, fontSize:13}}>WhatsApp Numbers (E.164)</div>
                <div style={{display:"grid", gap:8}}>
                    {whatsapp_numbers.map((v,i)=>(
                        <div key={i} style={{display:"grid",gridTemplateColumns:"1fr auto",gap:8,alignItems:"center"}}>
                            <input value={v} onChange={e=>setWaNum(i,e.target.value)} placeholder="+447123456789"/>
                            <button type="button" onClick={()=>removeWaNum(i)} style={{padding:"8px 10px",borderRadius:10,border:"1px solid #ccc"}}>
                                Remove
                            </button>
                        </div>
                    ))}
                    <button type="button" onClick={addWaNum} disabled={whatsapp_numbers.length>=5} 
                        style={{width:"fit-content", padding:"6px 10px",fontSize:13}}>
                        + Add Number
                    </button>
                </div>
                <label style={{display:"flex",gap:10,alignItems:"center", marginTop:4}}>
                    <input type="checkbox" checked={whatsapp_consent} onChange={()=>setWhatsappConsent(v=>!v)}/>
                    <span style={{fontSize:13}}>I consent to receive WhatsApp alerts</span>
                </label>
            </div>
          ):null}

          {/* Slack Section */}
          <label style={{display:"flex",gap:10,alignItems:"center",marginBottom:10}}>
            <input type="checkbox" checked={slack_enabled} onChange={()=>setSlackEnabled(v=>!v)}/>
            <span>Slack (Incoming Webhook)</span>
          </label>
          {slack_enabled?(
             <div style={{marginLeft:28, marginBottom:10, display:"grid", gap:10}}>
                <div style={{fontWeight:600, fontSize:13}}>Slack Webhook URLs</div>
                <div style={{display:"grid", gap:8}}>
                    {slack_urls.map((v,i)=>(
                        <div key={i} style={{display:"grid",gridTemplateColumns:"1fr auto",gap:8,alignItems:"center"}}>
                            <input value={v} onChange={e=>setSlackUrl(i,e.target.value)} placeholder="https://hooks.slack.com/services/..."/>
                            <button type="button" onClick={()=>removeSlackUrl(i)} style={{padding:"8px 10px",borderRadius:10,border:"1px solid #ccc"}}>
                                Remove
                            </button>
                        </div>
                    ))}
                    <button type="button" onClick={addSlackUrl} disabled={slack_urls.length>=5} 
                        style={{width:"fit-content", padding:"6px 10px",fontSize:13}}>
                        + Add URL
                    </button>
                </div>
            </div>
          ):null}
        </div>

        {/* STEP 4b: Routing */}
        <div style={{border:"1px solid #ddd",borderRadius:10,padding:16}}>
          <h3 style={{marginTop:0}}>Step 4b: Route Risks</h3>
          <div style={{display:"grid", gap:16}}>
            <div>
                <div style={{fontWeight:600,marginBottom:6}}>High Risk routes to:</div>
                <div style={{display:"flex", gap:16}}>
                    <label style={{display:"flex",gap:6,alignItems:"center", opacity: whatsapp_enabled?1:0.5}}>
                        <input type="checkbox" checked={routing_high.includes("whatsapp")} 
                            onChange={()=>toggleRouting('high','whatsapp')} disabled={!whatsapp_enabled}/>
                        WhatsApp
                    </label>
                    <label style={{display:"flex",gap:6,alignItems:"center", opacity: slack_enabled?1:0.5}}>
                        <input type="checkbox" checked={routing_high.includes("slack")} 
                             onChange={()=>toggleRouting('high','slack')} disabled={!slack_enabled}/>
                        Slack
                    </label>
                    <label style={{display:"flex",gap:6,alignItems:"center"}}>
                        <input type="checkbox" checked={routing_high.includes("digest")} 
                             onChange={()=>toggleRouting('high','digest')}/>
                        Digest
                    </label>
                </div>
            </div>
            <div>
                <div style={{fontWeight:600,marginBottom:6}}>Medium Risk routes to:</div>
                <div style={{display:"flex", gap:16}}>
                    <label style={{display:"flex",gap:6,alignItems:"center", opacity: whatsapp_enabled?1:0.5}}>
                        <input type="checkbox" checked={routing_medium.includes("whatsapp")} 
                             onChange={()=>toggleRouting('medium','whatsapp')} disabled={!whatsapp_enabled}/>
                        WhatsApp
                    </label>
                    <label style={{display:"flex",gap:6,alignItems:"center", opacity: slack_enabled?1:0.5}}>
                        <input type="checkbox" checked={routing_medium.includes("slack")} 
                             onChange={()=>toggleRouting('medium','slack')} disabled={!slack_enabled}/>
                        Slack
                    </label>
                    <label style={{display:"flex",gap:6,alignItems:"center"}}>
                        <input type="checkbox" checked={routing_medium.includes("digest")} 
                             onChange={()=>toggleRouting('medium','digest')}/>
                        Digest
                    </label>
                </div>
            </div>
             <div>
                <div style={{fontWeight:600,marginBottom:6}}>Low Risk routes to:</div>
                <select value={routing_low} onChange={e=>setRoutingLow(e.target.value)}>
                    <option value="ignore">Ignore (No alert)</option>
                    <option value="digest">Daily Digest</option>
                </select>
            </div>
          </div>
        </div>

        {/* STEP 4c: Daily Digest */}
        <div style={{border:"1px solid #ddd",borderRadius:10,padding:16}}>
          <h3 style={{marginTop:0}}>Step 4c: Daily Digest</h3>
          <label style={{display:"flex",gap:10,alignItems:"center",marginBottom:12}}>
            <input type="checkbox" checked={digest_enabled} onChange={()=>setDigestEnabled(v=>!v)}/>
            <span>Send daily digest email</span>
          </label>
          {digest_enabled && (
             <div style={{display:"grid", gap:12, marginLeft:28}}>
                 <label style={{display:"grid",gap:6}}>
                    <span>Digest Recipient(s)</span>
                    <input value={digest_recipients} onChange={e=>setDigestRecipients(e.target.value)} placeholder="email1@co.com, email2@co.com"/>
                </label>
                <label style={{display:"grid",gap:6}}>
                    <span>Digest Time</span>
                    <input type="time" value={digest_time} onChange={e=>setDigestTime(e.target.value)} />
                </label>
             </div>
          )}
        </div>

        {/* Compliance */}
        <label style={{display:"flex",gap:10,alignItems:"flex-start", padding:10, background:"#f9f9f9", borderRadius:8}}>
            <input type="checkbox" style={{marginTop:4}} checked={compliance_accept} onChange={()=>setComplianceAccept(v=>!v)}/>
            <span style={{fontSize:13, lineHeight:1.4}}>
                I confirm I am authorised to connect these inboxes and I accept the <a href="#">Terms of Service</a> and <a href="#">Privacy Policy</a>.
            </span>
        </label>

        {err?(
          <div style={{background:"#fee",border:"1px solid #f99",padding:10,borderRadius:8}}>
            {err}
          </div>
        ):null}

        <button disabled={loading} style={{padding:"12px",borderRadius:10,border:"1px solid #ccc", background:"#222", color:"#fff", fontWeight:"bold"}}>
          {loading?"Submitting...":"Submit & Connect Inboxes"}
        </button>
      </form>
    </div>
  );
}