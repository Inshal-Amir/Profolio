import React, { useMemo, useState, useEffect } from "react";
import { postJSON, backendRedirectUrl } from "../lib/api.js";
import { useSearchParams } from "react-router-dom";

// --- Helpers ---
function isEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}
function isE164(v) {
  return /^\+[1-9]\d{6,14}$/.test(v.trim());
}
function normWord(s) {
  return (s || "").trim().toLowerCase();
}
function dedupeWords(arr) {
  return [...new Set(arr.map(normWord).filter(Boolean))];
}

// --- Constants ---
const BUSINESS_SIGNALS = {
  service: ["missed appointment", "quote", "late", "call me"],
  ecommerce: ["refund", "item missing", "delivery", "damaged"],
  saas: ["bug", "error", "login failed", "churn", "cancel"],
  bookings_hospitality: ["check-in", "reservation", "dietary", "room service"]
};

const UNIVERSAL_SIGNALS = [
  "urgent", "complaint", "escalate", "emergency"
];

const PRESETS = [
    { label: "Trades/Services", value: "service" },
    { label: "Ecommerce", value: "ecommerce" },
    { label: "SaaS", value: "saas" },
    { label: "Bookings/Hospitality", value: "bookings_hospitality" }
];

const EXT_COUNTRIES = [
    { code: "+44", flag: "🇬🇧" },
    { code: "+1", flag: "🇺🇸" },
    { code: "+61", flag: "🇦🇺" },
    { code: "+49", flag: "🇩🇪" },
    // Add more as needed
];

// Mock Plan - In real app, this would come from user session/context
const PLAN_FEATURES = {
    plan_name: "Pro", // "Starter", "Pro", "Enterprise"
    slack_integration: true, // Set to false to test "greyed out"
    retention_days: 90
};

export default function Onboarding() {
  const [searchParams] = useSearchParams();
  
  // --- Global State ---
  const [step, setStep] = useState(1);
  const [mailboxId, setMailboxId] = useState("");
  const [orgId, setOrgId] = useState(""); 
  
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  
  // Modal State
  const [modalContent, setModalContent] = useState(null); // { title: "", body: "" } or null

  // --- Form State ---
  const [formData, setFormData] = useState({
    company_name: "",
    contact_email: "",
    business_type: "service",
    timezone: "UTC",
    compliance_accept: false,
    
    monitored_addresses: [""],
    
    // Step 3
    selected_universal_signals: {}, 
    
    // Step 4
    whatsapp_enabled: true,
    whatsapp_numbers: [""],
    whatsapp_consent: false,
    
    slack_enabled: false,
    slack_urls: [""],
    
    routing_high: ["whatsapp"],
    routing_medium: ["whatsapp"],
    routing_low: "digest",
    
    digest_enabled: true,
    digest_recipients: "",
    digest_time: "15:00",
  });

  // --- Init ---
  useEffect(() => {
    // Restore from LocalStorage if possible
    const mid = searchParams.get("mailbox_id");
    const urlStep = parseInt(searchParams.get("step")) || 1;
    
    if (mid) {
      setMailboxId(mid);
      const cached = localStorage.getItem(`onboarding_${mid}`);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          setFormData(prev => ({ ...prev, ...parsed }));
        } catch (e) { console.error(e); }
      }
      setStep(urlStep);
    } else {
       // Try to set timezone
       try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        setFormData(prev => ({ ...prev, timezone: tz || "UTC" }));
      } catch (e) {}
    }
  }, [searchParams]);

  // Persist State
  useEffect(() => {
    if (mailboxId) {
      localStorage.setItem(`onboarding_${mailboxId}`, JSON.stringify(formData));
    }
  }, [formData, mailboxId]);
  
  // Default Medium Routing to Digest if fresh
  useEffect(() => {
      setFormData(p => {
          if(!p.routing_medium_set){ 
              return {...p, routing_medium: ["digest"], routing_medium_set: true}; 
          }
          return p;
      });
  }, []);


  // --- Handlers ---
  function update(field, value) {
    setFormData(prev => ({ ...prev, [field]: value }));
  }

  function handleArrayUpdate(field, index, value) {
    setFormData(prev => {
      const arr = [...prev[field]];
      arr[index] = value;
      return { ...prev, [field]: arr };
    });
  }

  function addArrayItem(field) {
     setFormData(prev => {
         if(prev[field].length >= 5) return prev;
         return { ...prev, [field]: [...prev[field], ""] };
     });
  }
  
  function removeArrayItem(field, index) {
      setFormData(prev => {
          const arr = prev[field].filter((_, i) => i !== index);
          return { ...prev, [field]: arr.length ? arr : [""] };
      });
  }

  function toggleSignal(signal) {
      setFormData(prev => ({
          ...prev,
          selected_universal_signals: {
              ...prev.selected_universal_signals,
              [signal]: !prev.selected_universal_signals[signal]
          }
      }));
  }

  function toggleRouting(level, channel) {
      // Check Plan for Slack
      if (channel === "slack" && !PLAN_FEATURES.slack_integration) return;

      const field = `routing_${level}`;
      setFormData(prev => {
          const current = prev[field] || [];
          if (current.includes(channel)) {
              return { ...prev, [field]: current.filter(c => c !== channel) };
          } else {
              return { ...prev, [field]: [...current, channel] };
          }
      });
  }

  // --- Step Actions ---

  async function startOnboarding() {
    setErr("");
    const { company_name, contact_email, business_type, compliance_accept, monitored_addresses } = formData;
    
    if (company_name.length < 2) return setErr("Company name required.");
    if (!isEmail(contact_email)) return setErr("Valid contact email required.");
    if (!compliance_accept) return setErr("Please accept the Terms.");
    
    const validEmails = monitored_addresses.map(m => m.trim()).filter(isEmail);
    if (validEmails.length < 1) return setErr("Add at least one valid email to monitor.");

    setLoading(true);
    try {
        const payload = {
            company_name,
            contact_email,
            business_type,
            timezone: formData.timezone,
            compliance_accept,
            monitored_addresses: validEmails
        };
        
        const res = await postJSON("/onboarding/start", payload);
        if (!res.mailbox_id) throw new Error("No ID returned");
        
        setMailboxId(res.mailbox_id);
        setOrgId(res.org_id);
        
        // Save state immediately
        localStorage.setItem(`onboarding_${res.mailbox_id}`, JSON.stringify(formData));
        
        // Initiate OAuth Loop
        window.location.href = backendRedirectUrl(`/api/oauth/dispatch?org_id=${res.org_id}&mailbox_id=${res.mailbox_id}`);
        
    } catch (e) {
        setErr(e.message || "Failed to start.");
        setLoading(false);
    }
  }

  async function finalize() {
     setErr("");
     setLoading(true);
     
     // construct final config
     const signals = [
         ...Object.keys(formData.selected_universal_signals).filter(k=>formData.selected_universal_signals[k]),
         ...(BUSINESS_SIGNALS[formData.business_type] || [])
     ];
     
     // Validate Alerts
     const channels = [];
     if(formData.whatsapp_enabled) channels.push("whatsapp");
     if(formData.slack_enabled) channels.push("slack");
     
     if(channels.length === 0) {
         setLoading(false);
         return setErr("Please enable at least one alert channel (Step 4).");
     }
     
     const payload = {
         mailbox_id: mailboxId,
         config: {
             default_signals_selected: signals,
             alert_channels: channels,
             whatsapp_numbers: formData.whatsapp_enabled ? formData.whatsapp_numbers.filter(x=>x.trim()) : [],
             whatsapp_consent: formData.whatsapp_consent,
             slack_webhook_urls: formData.slack_enabled ? formData.slack_urls.filter(x=>x.trim()) : [],
             routing: {
                 high: formData.routing_high,
                 medium: formData.routing_medium,
                 low: formData.routing_low
             },
             digest: {
                 enabled: formData.digest_enabled,
                 recipients: formData.digest_recipients || formData.contact_email,
                 time: formData.digest_time
             }
         }
     };
     
     try {
         await postJSON("/onboarding/finalize", payload);
         window.location.href = "/success?mailbox_id=" + mailboxId; 
     } catch(e) {
         setErr(e.message || "Failed to finalize.");
         setLoading(false);
     }
  }
  
  // --- Components ---
  
  function showTerms() {
      setModalContent({
          title: "Terms of Service",
          body: (
              <div style={{lineHeight: 1.6}}>
                  <p><strong>1. Acceptance</strong><br/>By connecting your inbox, you agree to allow Mailwise to scan your emails for specified signals.</p>
                  <p><strong>2. Data Usage</strong><br/>We only store metadata associated with alerts. We do not store email bodies permanently.</p>
                  <p><strong>3. Liability</strong><br/>Mailwise is an assistance tool. We are not responsible for missed alerts.</p>
              </div>
          )
      });
  }
  
  function showPrivacy() {
      setModalContent({
          title: "Privacy Policy",
          body: (
              <div style={{lineHeight: 1.6}}>
                  <p><strong>1. Collection</strong><br/>We collect your email address and business details.</p>
                  <p><strong>2. Processing</strong><br/>Email processing happens in secure volatile memory.</p>
                  <p><strong>3. Third Parties</strong><br/>We use Google and Microsoft APIs strictly for the purpose of providing this service.</p>
              </div>
          )
      });
  }

  // --- Render ---
  
  const STEPS = [
      "Biz Info", "Connect", "Signals", "Routes", "Review"
  ];

  return (
    <div style={{fontFamily: "'Inter', system-ui, sans-serif", background:"#f4f6f8", minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", padding: 20}}>
        
        {/* MODAL */}
        {modalContent && (
            <div style={{position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex: 999}}>
                <div style={{background:"white", padding: 30, borderRadius: 16, maxWidth: 500, width:"100%", maxHeight:"80vh", overflowY:"auto"}}>
                    <h2 style={{marginTop:0, fontSize: 22}}>{modalContent.title}</h2>
                    <div style={{color:"#475569", margin:"20px 0"}}>{modalContent.body}</div>
                    <button onClick={()=>setModalContent(null)} style={primaryBtn}>Close</button>
                </div>
            </div>
        )}
        
        <div style={{background:"white", width:"100%", maxWidth: 900, borderRadius: 16, boxShadow: "0 10px 30px rgba(0,0,0,0.05)", display:"flex", overflow:"hidden", minHeight: 600}}>
            
            {/* Sidebar / Progress */}
            <div style={{width: 240, background: "#f8fafc", borderRight: "1px solid #eef2f6", padding: 30, display:"flex", flexDirection:"column"}}>
                <h2 style={{fontSize: 20, fontWeight: 700, color:"#1e293b", marginBottom: 40}}>Mailwise.</h2>
                
                <div style={{display:"flex", flexDirection:"column", gap: 24}}>
                    {STEPS.map((s, idx) => {
                        const num = idx + 1;
                        const active = num === step;
                        const done = num < step;
                        
                        return (
                            <div key={num} style={{display:"flex", alignItems:"center", gap: 12, opacity: (active || done) ? 1 : 0.4}}>
                                <div style={{
                                    width: 28, height: 28, borderRadius: "50%", 
                                    background: active ? "#2563eb" : (done ? "#10b981" : "#cbd5e1"),
                                    color: "white", display:"flex", alignItems:"center", justifyContent:"center",
                                    fontSize: 12, fontWeight: 700
                                }}>
                                    {done ? "✓" : num}
                                </div>
                                <div style={{fontSize: 14, fontWeight: 500, color: active ? "#0f172a" : "#64748b"}}>
                                    {s}
                                </div>
                            </div>
                        );
                    })}
                </div>
                
                <div style={{marginTop: "auto", fontSize: 12, color:"#94a3b8"}}>
                    Status: {PLAN_FEATURES.plan_name} Plan
                </div>
            </div>
            
            {/* Main Content */}
            <div style={{flex: 1, padding: 40, display:"flex", flexDirection:"column"}}>
                
                <div style={{marginBottom: 20}}>
                    <h1 style={{fontSize: 24, fontWeight: 700, margin: 0, marginBottom: 8}}>
                        {step === 1 && "Tell us about your business"}
                        {step === 2 && "Connect your inboxes"}
                        {step === 3 && "Configure Signals"}
                        {step === 4 && "Alerting & Routing"}
                        {step === 5 && "Review & Launch"}
                    </h1>
                    <p style={{margin: 0, color: "#64748b"}}>
                         {step === 1 && "We'll tailor the AI to your industry."}
                         {step === 2 && "Securely connect via Google or Microsoft."}
                         {step === 3 && "Select what you want to be alerted about."}
                         {step === 4 && "Where should alerts go?"}
                         {step === 5 && "Almost there! One last look."}
                    </p>
                </div>
                
                <div style={{flex: 1, overflowY:"auto"}}>
                    {err && <div style={{background:"#fef2f2", color:"#991b1b", padding: 12, borderRadius: 8, marginBottom: 20, fontSize: 14}}>{err}</div>}
                    
                    {/* --- STEP 1 --- */}
                    {step === 1 && (
                        <div style={{display:"grid", gap: 20}}>
                             <label style={{display:"block"}}>
                                <span style={{display:"block", fontSize: 13, fontWeight: 600, marginBottom: 6}}>Company Name</span>
                                <input style={inputStyle} value={formData.company_name} onChange={e=>update("company_name", e.target.value)} placeholder="Acme Inc."/>
                            </label>
                            
                            <label style={{display:"block"}}>
                                <span style={{display:"block", fontSize: 13, fontWeight: 600, marginBottom: 6}}>Business Type</span>
                                <select style={inputStyle} value={formData.business_type} onChange={e=>update("business_type", e.target.value)}>
                                    {PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                                </select>
                            </label>
                            
                            <div style={{background:"#f1f5f9", padding: 16, borderRadius: 8}}>
                                <div style={{fontSize: 12, fontWeight: 600, color:"#475569", marginBottom: 8, textTransform:"uppercase"}}>Included Signals for {formData.business_type}</div>
                                <div style={{display:"flex", flexWrap:"wrap", gap: 8}}>
                                    {(BUSINESS_SIGNALS[formData.business_type]||[]).map(s => (
                                        <span key={s} style={{background:"white", border:"1px solid #cbd5e1", padding:"4px 8px", borderRadius: 4, fontSize: 12, color:"#334155"}}>
                                            {s}
                                        </span>
                                    ))}
                                </div>
                            </div>

                            <label style={{display:"block"}}>
                                <span style={{display:"block", fontSize: 13, fontWeight: 600, marginBottom: 6}}>Contact Email</span>
                                <input style={inputStyle} type="email" value={formData.contact_email} onChange={e=>update("contact_email", e.target.value)} placeholder="you@company.com"/>
                            </label>
                            
                            <div style={{fontSize:12, color:"#94a3b8"}}>Timezone detected: {formData.timezone}</div>
                        </div>
                    )}

                    {/* --- STEP 2 --- */}
                    {step === 2 && (
                        <div style={{display:"grid", gap: 20}}>
                            <div style={{display:"grid", gap: 12}}>
                                {formData.monitored_addresses.map((email, idx) => (
                                    <div key={idx} style={{display:"flex", gap: 10}}>
                                        <div style={{flex: 1, position:"relative"}}>
                                            <input 
                                                style={{...inputStyle, paddingRight: 40}}
                                                value={email} 
                                                onChange={e=>handleArrayUpdate("monitored_addresses", idx, e.target.value)}
                                                placeholder="support@company.com"
                                                disabled={!!mailboxId} // Disable editing if already started flow for simplicity? Or allowed?
                                            />
                                            {/* Fake Green Check if we are on step 2 (returned from oauth) */}
                                            {mailboxId && (
                                                <div style={{position:"absolute", right: 10, top: "50%", transform:"translateY(-50%)", color:"#10b981", fontSize: 18}}>
                                                    ✓
                                                </div>
                                            )}
                                        </div>
                                        {!mailboxId && (
                                            <button onClick={()=>removeArrayItem("monitored_addresses", idx)} style={{color:"#ef4444", background:"none", border:"none", cursor:"pointer"}}>✕</button>
                                        )}
                                    </div>
                                ))}
                                {!mailboxId && formData.monitored_addresses.length < 5 && (
                                    <button onClick={()=>addArrayItem("monitored_addresses")} style={{width:"fit-content", fontSize: 13, color:"#2563eb", background:"none", border:"none", cursor:"pointer"}}>
                                        + Add another email
                                    </button>
                                )}
                            </div>
                            
                            {!mailboxId && (
                                <div style={{marginTop: 10}}>
                                    <label style={{display:"flex", gap: 10, alignItems:"start", fontSize: 13, color:"#475569"}}>
                                        <input type="checkbox" checked={formData.compliance_accept} onChange={e=>update("compliance_accept", e.target.checked)} />
                                        <span>
                                            I confirm I have authority to connect these inboxes and accept the 
                                            <a href="#" onClick={e=>{e.preventDefault(); showTerms();}} style={{color:"#2563eb", margin:"0 4px"}}>Terms</a>
                                             and 
                                            <a href="#" onClick={e=>{e.preventDefault(); showPrivacy();}} style={{color:"#2563eb", margin:"0 4px"}}>Privacy Policy</a>.
                                        </span>
                                    </label>
                                </div>
                            )}

                            {mailboxId && (
                                <div style={{background:"#ecfdf5", padding: 16, borderRadius: 8, color:"#065f46", fontSize: 14}}>
                                    <strong>Connected!</strong> Your inboxes are largely authorized. Click Next to configure rules.
                                </div>
                            )}
                        </div>
                    )}

                    {/* --- STEP 3 --- */}
                    {step === 3 && (
                        <div>
                           <h3 style={{fontSize: 16, fontWeight: 600, marginBottom: 12}}>Universal Signals</h3>
                           <div style={{display:"grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 24}}>
                               {UNIVERSAL_SIGNALS.map(s => (
                                   <label key={s} style={{
                                       display:"flex", alignItems:"center", gap: 10, padding: 12, borderRadius: 8,
                                       border: formData.selected_universal_signals[s] ? "1px solid #2563eb" : "1px solid #e2e8f0",
                                       background: formData.selected_universal_signals[s] ? "#eff6ff" : "white",
                                       cursor: "pointer"
                                   }}>
                                       <input type="checkbox" checked={!!formData.selected_universal_signals[s]} onChange={()=>toggleSignal(s)} />
                                       <span style={{textTransform:"capitalize"}}>{s}</span>
                                   </label>
                               ))}
                           </div>
                           
                           <h3 style={{fontSize: 16, fontWeight: 600, marginBottom: 12}}>Business Signals ({formData.business_type})</h3>
                           <div style={{display:"flex", flexWrap:"wrap", gap: 8, opacity: 0.8}}>
                                {(BUSINESS_SIGNALS[formData.business_type]||[]).map(s => (
                                    <span key={s} style={{background:"#f1f5f9", boxShadow:"0 1px 2px rgba(0,0,0,0.05)", border:"1px solid #cbd5e1", padding:"6px 10px", borderRadius: 4, fontSize: 13, color:"#334155"}}>
                                        {s}
                                    </span>
                                ))}
                            </div>
                            <div style={{fontSize: 12, color:"#94a3b8", marginTop: 8}}>These are automatically monitored for you.</div>
                        </div>
                    )}

                    {/* --- STEP 4 --- */}
                    {step === 4 && (
                        <div style={{display:"grid", gap: 24}}>
                            
                            {/* Alert Channels */}
                            <div style={{padding: 20, background:"#fff", border:"1px solid #e2e8f0", borderRadius: 10}}>
                                <label style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom: formData.whatsapp_enabled ? 16 : 0}}>
                                    <div style={{fontWeight: 600}}>WhatsApp Alerts</div>
                                    <input type="checkbox" checked={formData.whatsapp_enabled} onChange={e=>update("whatsapp_enabled", e.target.checked)}/>
                                </label>
                                
                                {formData.whatsapp_enabled && (
                                    <div style={{display:"grid", gap: 10}}>
                                        {formData.whatsapp_numbers.map((num, i) => (
                                            <div key={i} style={{display:"flex", gap: 8}}>
                                                <select style={{width: 80, ...inputStyle}}>
                                                    {EXT_COUNTRIES.map(c => <option key={c.code}>{c.code} {c.flag}</option>)}
                                                </select>
                                                <input 
                                                    style={{...inputStyle, flex:1}} 
                                                    value={num} 
                                                    onChange={e=>handleArrayUpdate("whatsapp_numbers", i, e.target.value)} 
                                                    placeholder="7123456789"
                                                />
                                            </div>
                                        ))}
                                        <div style={{display:"flex", gap:12}}>
                                             <button onClick={()=>addArrayItem("whatsapp_numbers")} style={{fontSize: 13, color:"#2563eb", background:"none", border:"none", cursor:"pointer"}}>+ Add Number</button>
                                             <button onClick={()=>alert("Test Alert Sent!")} style={{fontSize: 13, color:"#2563eb", background:"none", border:"none", cursor:"pointer"}}>Send Test Alert &rarr;</button>
                                        </div>
                                       
                                        <label style={{display:"flex", gap: 8, fontSize: 12, marginTop: 8}}>
                                            <input type="checkbox" checked={formData.whatsapp_consent} onChange={e=>update("whatsapp_consent", e.target.checked)} />
                                            I consent to receive WhatsApp alerts.
                                        </label>
                                    </div>
                                )}
                            </div>

                            {/* Slack Section -- CONDITIONAL */}
                            <div style={{padding: 20, background: PLAN_FEATURES.slack_integration ? "#fff" : "#f1f5f9", border:"1px solid #e2e8f0", borderRadius: 10, opacity: PLAN_FEATURES.slack_integration ? 1 : 0.6}}>
                                <label style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom: (formData.slack_enabled && PLAN_FEATURES.slack_integration) ? 16 : 0}}>
                                    <div style={{fontWeight: 600}}>
                                        Slack Alerts 
                                        {!PLAN_FEATURES.slack_integration && <span style={{fontSize:11, background:"#cbd5e1", padding:"2px 6px", borderRadius:4, marginLeft:8}}>Upgrade Required</span>}
                                    </div>
                                    <input type="checkbox" checked={formData.slack_enabled} onChange={e=>update("slack_enabled", e.target.checked)} disabled={!PLAN_FEATURES.slack_integration}/>
                                </label>
                                
                                {formData.slack_enabled && PLAN_FEATURES.slack_integration && (
                                     <div style={{display:"grid", gap: 10}}>
                                        {formData.slack_urls.map((v,i)=>(
                                            <div key={i} style={{display:"flex", gap: 8}}>
                                                <input value={v} onChange={e=>handleArrayUpdate("slack_urls", i, e.target.value)} placeholder="https://hooks.slack.com/..." style={inputStyle}/>
                                                <button onClick={()=>removeArrayItem("slack_urls", i)} style={{color:"#ef4444", background:"none", border:"none", cursor:"pointer"}}>✕</button>
                                            </div>
                                        ))}
                                        <button onClick={()=>addArrayItem("slack_urls")} style={{width:"fit-content", fontSize: 13, color:"#2563eb", background:"none", border:"none", cursor:"pointer"}}>+ Add URL</button>
                                    </div>
                                )}
                            </div>

                            {/* Routing */}
                             <div style={{padding: 20, background:"#fff", border:"1px solid #e2e8f0", borderRadius: 10}}>
                                 <h4 style={{marginTop:0, marginBottom:16}}>Routing Logic</h4>
                                 
                                 <div style={{display:"grid", gap: 16}}>
                                     <div style={{display:"grid", gridTemplateColumns:"100px 1fr", alignItems:"center"}}>
                                         <span style={{color:"#ef4444", fontWeight:600}}>High Risk</span>
                                         <div style={{display:"flex", gap: 16}}>
                                              {["whatsapp","slack","digest"].map(c => (
                                                  <label key={c} style={{display:"flex", gap: 6, alignItems:"center", fontSize:13, textTransform:"capitalize", opacity: ((c==="whatsapp" && !formData.whatsapp_enabled) || (c==="slack" && (!formData.slack_enabled || !PLAN_FEATURES.slack_integration))) ? 0.5 : 1}}>
                                                      <input type="checkbox" 
                                                        checked={formData.routing_high.includes(c)} 
                                                        onChange={()=>toggleRouting("high", c)}
                                                        disabled={(c==="whatsapp" && !formData.whatsapp_enabled) || (c==="slack" && (!formData.slack_enabled || !PLAN_FEATURES.slack_integration))}
                                                      />
                                                      {c} {c==="slack" && !PLAN_FEATURES.slack_integration && "🔒"}
                                                  </label>
                                              ))}
                                         </div>
                                     </div>
                                     
                                     <div style={{display:"grid", gridTemplateColumns:"100px 1fr", alignItems:"center"}}>
                                         <span style={{color:"#f59e0b", fontWeight:600}}>Medium</span>
                                         <div style={{display:"flex", gap: 16}}>
                                              {["whatsapp","slack","digest"].map(c => (
                                                  <label key={c} style={{display:"flex", gap: 6, alignItems:"center", fontSize:13, textTransform:"capitalize", opacity: ((c==="whatsapp" && !formData.whatsapp_enabled) || (c==="slack" && (!formData.slack_enabled || !PLAN_FEATURES.slack_integration))) ? 0.5 : 1}}>
                                                      <input type="checkbox" 
                                                        checked={formData.routing_medium.includes(c)} 
                                                        onChange={()=>toggleRouting("medium", c)}
                                                        disabled={(c==="whatsapp" && !formData.whatsapp_enabled) || (c==="slack" && (!formData.slack_enabled || !PLAN_FEATURES.slack_integration))}
                                                      />
                                                      {c} {c==="slack" && !PLAN_FEATURES.slack_integration && "🔒"}
                                                  </label>
                                              ))}
                                         </div>
                                     </div>
                                 </div>
                             </div>
                             
                             {/* Digest */}
                            <div style={{padding: 20, background:"#fff", border:"1px solid #e2e8f0", borderRadius: 10}}>
                                 <label style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom: formData.digest_enabled ? 16 : 0}}>
                                    <div style={{fontWeight: 600}}>Daily Digest</div>
                                    <input type="checkbox" checked={formData.digest_enabled} onChange={e=>update("digest_enabled", e.target.checked)}/>
                                </label>
                                {formData.digest_enabled && (
                                    <div style={{display:"grid", gridTemplateColumns: "1fr 100px", gap: 10}}>
                                        <input style={inputStyle} value={formData.digest_recipients || formData.contact_email} onChange={e=>update("digest_recipients", e.target.value)} placeholder="Email(s)"/>
                                        <input style={inputStyle} type="time" value={formData.digest_time} onChange={e=>update("digest_time", e.target.value)} />
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                    
                    {/* --- STEP 5 --- */}
                    {step === 5 && (
                        <div style={{display:"grid", gap: 20}}>
                            <div style={{background:"#f8fafc", padding: 20, borderRadius: 10, display:"grid", gap: 12}}>
                                <Row label="Company" val={formData.company_name} />
                                <Row label="Inboxes" val={formData.monitored_addresses.join(", ")} />
                                <Row label="Signals" val={`${Object.keys(formData.selected_universal_signals).length} universal, All ${formData.business_type}`} />
                                <Row label="Alerts" val={formData.whatsapp_enabled ? "WhatsApp Enabled" : "No Instant Alerts"} />
                                <Row label="Digest" val={formData.digest_enabled ? `Daily at ${formData.digest_time}` : "Disabled"} />
                            </div>
                            
                            <div style={{display:"flex", gap: 12}}>
                                <button onClick={()=>alert("Sending test alert...")} style={secondaryBtn}>Send Test Alert</button>
                                <button onClick={()=>alert("Sending test digest...")} style={secondaryBtn}>Send Test Digest</button>
                            </div>
                        </div>
                    )}

                </div>
                
                {/* Footer / Nav */}
                <div style={{paddingTop: 20, borderTop:"1px solid #e2e8f0", display:"flex", justifyContent:"space-between"}}>
                    <button 
                        onClick={() => setStep(s => Math.max(1, s - 1))}
                        disabled={step === 1 || (step === 2 && !mailboxId)} 
                        style={{...secondaryBtn, opacity: (step === 1 || (step === 2 && !mailboxId)) ? 0.5 : 1}}
                    >
                        Back
                    </button>
                    
                    {step === 2 && !mailboxId ? (
                         <button onClick={startOnboarding} disabled={loading} style={primaryBtn}>
                             {loading ? "Connecting..." : "Connect Inboxes"}
                         </button>
                    ) : step === 5 ? (
                         <button onClick={finalize} disabled={loading} style={{...primaryBtn, background:"#10b981"}}>
                             {loading ? "Finishing..." : "Complete Setup"}
                         </button>
                    ) : (
                         <button onClick={() => setStep(s => Math.min(5, s + 1))} style={primaryBtn}>
                             Next &rarr;
                         </button>
                    )}
                </div>
                
            </div>
        </div>
    </div>
  );
}

// --- Styles & Subcomponents ---

const inputStyle = {
    padding: "10px 12px", borderRadius: 8, border: "1px solid #cbd5e1", width: "100%", fontSize: 14, outline: "none"
};

const primaryBtn = {
    padding: "10px 20px", borderRadius: 8, border: "none", background: "#0f172a", color: "white", fontWeight: 600, cursor: "pointer", fontSize: 14
};

const secondaryBtn = {
    padding: "10px 20px", borderRadius: 8, border: "1px solid #cbd5e1", background: "white", color: "#334155", fontWeight: 500, cursor: "pointer", fontSize: 14
};

function Row({label, val}) {
    return (
        <div style={{display:"flex", justifyContent:"space-between", borderBottom:"1px solid #e2e8f0", paddingBottom: 8}}>
            <span style={{color:"#64748b", fontSize: 13}}>{label}</span>
            <span style={{fontWeight: 500, fontSize: 13, textAlign:"right"}}>{val}</span>
        </div>
    );
}