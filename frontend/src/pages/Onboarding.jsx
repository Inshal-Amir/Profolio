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
const UNIVERSAL_SIGNALS = [
    { id: "U01", label: "Chargeback / Payment Dispute Intent", risk: "high" },
    { id: "U02", label: "Legal Action / Court Threat", risk: "high" },
    { id: "U03", label: "Regulator / Authority Mention", risk: "high" },
    { id: "U04", label: "Refund Ultimatum / Escalation", risk: "high" },
    { id: "U05", label: "Cancellation Ultimatum", risk: "medium" },
    { id: "U06", label: "Reputation Threat (Reviews / Social)", risk: "high" },
    { id: "U07", label: "Abusive / Threatening Language", risk: "high" },
    { id: "U08", label: "Urgency / Deadline Language", risk: "medium" },
    { id: "U09", label: "No Response / Repeated Chasers", risk: "medium" },
    { id: "U10", label: "Executive / VIP Escalation", risk: "high" },
    { id: "U11", label: "Data Privacy / Subject Access / Deletion", risk: "high" }
];

const PROFILE_SIGNALS = {
    ecommerce: [
        { id: "E01", label: "Non-delivery / Missing Parcel", risk: "medium" },
        { id: "E02", label: "Damaged / Wrong Item / Missing Items", risk: "medium" },
        { id: "E03", label: "Tracking / Courier Escalation", risk: "medium" },
        { id: "E04", label: "Return Label / RMA / Return Window", risk: "medium" }, // averaged low/medium to medium for simplicity per user default rules
        { id: "E05", label: "Refund Delay", risk: "medium" },
        { id: "E06", label: "Subscription Cancellation / Renewal Complaint", risk: "medium" },
        { id: "E07", label: "Fraud / Unauthorised Transaction", risk: "high" }
    ],
    service: [
        { id: "S01", label: "No Show / Missed Appointment", risk: "medium" },
        { id: "S02", label: "Late / Repeated Delays", risk: "medium" },
        { id: "S03", label: "Work Not Fixed / Poor Workmanship", risk: "medium" },
        { id: "S04", label: "Property Damage / Insurance Claim Threat", risk: "high" },
        { id: "S05", label: "Deposit Refund / Cancellation Dispute", risk: "medium" },
        { id: "S06", label: "Invoice Dispute / Overcharged", risk: "medium" },
        { id: "S07", label: "Safety / Compliance Allegations", risk: "high" }
    ],
    saas: [ // Mapping Agency / B2B to 'saas' preset
        { id: "A01", label: "Termination / Churn Signals", risk: "high" },
        { id: "A02", label: "Breach / SLA / Missed Deadline", risk: "high" },
        { id: "A03", label: "Out of Scope / Scope Dispute", risk: "medium" },
        { id: "A04", label: "Invoice Dispute / Non-payment", risk: "high" },
        { id: "A05", label: "Stakeholder Escalation", risk: "high" }
    ],
    bookings_hospitality: [
        { id: "B01", label: "Cancellation / Refund Request", risk: "medium" },
        { id: "B02", label: "Double Charged / Billing Error", risk: "high" },
        { id: "B03", label: "No-show Fee Dispute", risk: "medium" },
        { id: "B04", label: "Serious Experience Complaint", risk: "high" },
        { id: "B05", label: "Injury / Incident Report", risk: "high" }
    ]
};

const PRESETS = [
    { label: "Ecommerce / DTC", value: "ecommerce" },
    { label: "Service Trades", value: "service" },
    { label: "Agency / B2B Services", value: "saas" },
    { label: "Bookings & Hospitality", value: "bookings_hospitality" }
];

const EXT_COUNTRIES = [
    { code: "+1", flag: "🇺🇸" },
    { code: "+44", flag: "🇬🇧" },
    { code: "+61", flag: "🇦🇺" },
    { code: "+49", flag: "🇩🇪" },
    { code: "+33", flag: "🇫🇷" },
    { code: "+34", flag: "🇪🇸" },
    { code: "+39", flag: "🇮🇹" },
    { code: "+31", flag: "🇳🇱" },
    { code: "+46", flag: "🇸🇪" },
    { code: "+41", flag: "🇨🇭" },
    { code: "+91", flag: "🇮🇳" },
    { code: "+86", flag: "🇨🇳" },
    { code: "+81", flag: "🇯🇵" },
    { code: "+82", flag: "🇰🇷" },
    { code: "+55", flag: "🇧🇷" },
    { code: "+52", flag: "🇲🇽" },
    { code: "+27", flag: "🇿🇦" },
    { code: "+971", flag: "🇦🇪" },
    { code: "+922", flag: "🇦🇪" },
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
  const [showConsentModal, setShowConsentModal] = useState(false);
  const [activeAccordion, setActiveAccordion] = useState("urgent"); // Default open category


  // --- Form State ---
  const [formData, setFormData] = useState({
    company_name: "",
    contact_email: "",
    business_type: "service",
    timezone: "UTC",
    compliance_accept: false,
    
    monitored_addresses: [""],
    
    // Step 2 & 3
    selected_universal_signals: {}, 
    selected_business_signals: {}, // New: toggleable business signals 
    
    // Step 4
    whatsapp_enabled: true,
    whatsapp_numbers: [""],
    whatsapp_codes: ["+1"], // Initialize with default code
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
  // --- Derived State ---
  const activeRecommendedSignals = useMemo(() => {
      return PROFILE_SIGNALS[formData.business_type] || PROFILE_SIGNALS["service"];
  }, [formData.business_type]);

  // --- Handlers ---
  function update(field, value) {
    setFormData(prev => ({ ...prev, [field]: value }));
  }
  
  function toggleSignal(label) {
      setFormData(prev => ({
          ...prev,
          selected_universal_signals: {
              ...prev.selected_universal_signals,
              [label]: !prev.selected_universal_signals[label]
          }
      }));
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
         const newState = { ...prev, [field]: [...prev[field], ""] };
         if (field === "whatsapp_numbers") {
             newState.whatsapp_codes = [...(prev.whatsapp_codes || []), "+1"];
         }
         return newState;
     });
  }
  
  function removeArrayItem(field, index) {
      setFormData(prev => {
          const arr = prev[field].filter((_, i) => i !== index);
          const newState = { ...prev, [field]: arr.length ? arr : [""] };
          
          if (field === "whatsapp_numbers") {
              const codes = (prev.whatsapp_codes || []).filter((_, i) => i !== index);
              newState.whatsapp_codes = codes.length ? codes : ["+1"];
          }
          return newState;
      });
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
         ...Object.keys(formData.selected_universal_signals).filter(k=>formData.selected_universal_signals[k])
     ];

     // Categorize signals
     const allSignals = [...UNIVERSAL_SIGNALS, ...activeRecommendedSignals];
     const highRiskSignals = [];
     const medRiskSignals = [];

     signals.forEach(sigLabel => {
        const found = allSignals.find(s => s.label === sigLabel);
        if (found) {
            if (found.risk === "high") highRiskSignals.push(sigLabel);
            else medRiskSignals.push(sigLabel); // Default to medium if not high
        }
     });
     
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
             // default_signals_selected: signals, // Removed in favor of split
             risk_identifiers_high: highRiskSignals,
             risk_identifiers_med: medRiskSignals,
             alert_channels: channels,
             whatsapp_numbers: formData.whatsapp_enabled ? formData.whatsapp_numbers.map((num, i) => {
                 if (!num.trim()) return null;
                 const code = formData.whatsapp_codes?.[i] || "+1";
                 return `${code}${num.trim()}`;
             }).filter(Boolean) : [],
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

  function handleConnectClick() {
      // Validate before opening modal
      const emails = formData.monitored_addresses.filter(x=>x.trim());
      if(emails.length === 0) return setErr("Please add at least one email.");
      setErr("");
      setShowConsentModal(true);
  }

  // --- Render ---
  
  const STEPS = [
      "Business Information", "Signals", "Routes", "Connect Inbox", "Review"
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

        {/* CONSENT MODAL */}
        {showConsentModal && (
            <div style={{position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex: 999}}>
                <div style={{background:"white", padding: 30, borderRadius: 16, maxWidth: 500, width:"100%", maxHeight:"80vh", display:"flex", flexDirection:"column"}}>
                    <h2 style={{marginTop:0, fontSize: 22}}>Terms & Privacy</h2>
                    <div style={{flex:1, overflowY:"auto", margin:"20px 0", border:"1px solid #e2e8f0", padding:16, borderRadius:8, background:"#f8fafc", fontSize:13, lineHeight:1.5}}>
                        <p><strong>Terms of Service</strong></p>
                        <p>By connecting your inbox, you agree to allow MailWise to scan your emails for specified signals. We only store metadata associated with alerts. We do not store email bodies permanently. MailWise is an assistance tool. We are not responsible for missed alerts.</p>
                        <p><strong>Privacy Policy</strong></p>
                        <p>We collect your email address and business details. Email processing happens in secure volatile memory. We use Google and Microsoft APIs strictly for the purpose of providing this service.</p>
                    </div>
                    
                    <label style={{display:"flex", gap: 10, alignItems:"start", fontSize: 13, color:"#475569", marginBottom: 20}}>
                        <input type="checkbox" checked={formData.compliance_accept} onChange={e=>update("compliance_accept", e.target.checked)} />
                        <span>I have read and agree to the Terms of Service and Privacy Policy.</span>
                    </label>
                    
                    <div style={{display:"flex", gap:12, justifyContent:"flex-end"}}>
                         <button onClick={()=>setShowConsentModal(false)} style={secondaryBtn}>Cancel</button>
                         <button onClick={()=>{
                             if(!formData.compliance_accept) return alert("Please accept the terms.");
                             startOnboarding();
                         }} disabled={!formData.compliance_accept || loading} style={{...primaryBtn, opacity: formData.compliance_accept ? 1 : 0.5}}>
                             {loading ? "Connecting..." : "Agree & Connect"}
                         </button>
                    </div>
                </div>
            </div>
        )}
        
        <div style={{background:"white", width:"100%", maxWidth: 900, borderRadius: 16, boxShadow: "0 10px 30px rgba(0,0,0,0.05)", display:"flex", overflow:"hidden", minHeight: 600}}>
            
            {/* Sidebar / Progress */}
            <div style={{width: 240, background: "#f8fafc", borderRight: "1px solid #eef2f6", padding: 30, display:"flex", flexDirection:"column"}}>
                <h2 style={{fontSize: 20, fontWeight: 700, color:"#1e293b", marginBottom: 40}}>MailWise</h2>
                
                <div style={{display:"flex", flexDirection:"column", gap: 24}}>
                    {STEPS.map((s, idx) => {
                        const num = idx + 1;
                        const active = num === step;
                        const done = num < step;
                        
                        return (
                            <div key={num} style={{display:"flex", alignItems:"center", gap: 12, opacity: (active || done) ? 1 : 0.4}}>
                                <div style={{
                                    width: 28, height: 28, borderRadius: "50%", 
                                    background: active ? "#6D6CFB" : (done ? "#10b981" : "#cbd5e1"),
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
                        {step === 1 && "Start by setting up the basics"}
                        {step === 2 && "Tell us which messages matter most"}
                        {step === 3 && "Alerting & Routing"}
                        {step === 4 && "Connect your inboxes"}
                        {step === 5 && "Review & Launch"}
                    </h1>
                    <p style={{margin: 0, color: "#64748b"}}>
                         {step === 1 && "We'll tailor the AI to your industry."}
                         {step === 2 && "Configure what MailWise looks for."}
                         {step === 3 && "Where should alerts go?"}
                         {step === 4 && "Securely connect via Google or Microsoft."}
                         {step === 5 && "Almost there! One last look."}
                    </p>
                </div>
                
                <div style={{flex: 1, overflowY:"auto"}}>
                    {err && <div style={{background:"#fef2f2", color:"#991b1b", padding: 12, borderRadius: 8, marginBottom: 20, fontSize: 14}}>{err}</div>}
                    
                    {/* --- STEP 1: Business Information --- */}
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
                                    {/* Just showing a flat list of some signals for preview */ }
                                    {activeRecommendedSignals.slice(0,3).map(s => (
                                        <span key={s.label} style={{background:"white", border:"1px solid #cbd5e1", padding:"4px 8px", borderRadius: 4, fontSize: 12, color:"#334155"}}>
                                            {s.label}
                                        </span>
                                    ))}
                                </div>
                            </div>

                            <label style={{display:"block"}}>
                                <span style={{display:"block", fontSize: 13, fontWeight: 600, marginBottom: 6}}>Contact Email</span>
                                <input style={inputStyle} type="email" value={formData.contact_email} onChange={e=>update("contact_email", e.target.value)} placeholder="you@company.com"/>
                            </label>
                        </div>
                    )}

                    {/* --- STEP 2: Signals (New Flat UI) --- */}
                    {step === 2 && (
                        <div>
                           <div style={{textAlign:"center", marginBottom: 30}}>
                               <h2 style={{fontSize: 20, fontWeight: 700, color: "#1e293b", margin: "0 0 8px 0"}}>Configure signals</h2>
                               <p style={{margin: 0, color: "#64748b", fontSize: 15}}>Choose what Mailwise should <strong style={{color:"#1e293b"}}>watch for</strong></p>
                           </div>

                           {/* Recommended Section - Boxed */}
                           <div style={{border:"1px solid #e2e8f0", borderRadius: 8, overflow:"hidden", marginBottom: 24, background: "#f8fafc"}}>
                               <div style={{padding: "12px 16px", borderBottom: "1px solid #e2e8f0", background: "#f1f5f9"}}>
                                   <div style={{fontWeight: 700, fontSize: 14, color: "#334155"}}>Recommended Signals based on your business type</div>
                               </div>
                               <div style={{padding: "12px 16px", fontSize: 13, color: "#64748b", borderBottom: "1px solid #e2e8f0", background: "#f8fafc"}}>
                                   Pre-selected based on your business. You can change these anytime.
                               </div>
                               <div style={{background: "#eff6ff"}}>
                                    {activeRecommendedSignals.map((s, idx) => (
                                        <label key={s.label} style={{
                                            display:"flex", alignItems:"center", gap: 12, padding: "12px 16px", cursor: "pointer",
                                            borderBottom: idx < activeRecommendedSignals.length - 1 ? "1px solid #dae4f3" : "none",
                                            background: !!formData.selected_universal_signals[s.label] ? "#eff6ff" : "white"
                                        }}>
                                           <div style={{
                                               width: 20, height: 20, borderRadius: 4, 
                                               background: !!formData.selected_universal_signals[s.label] ? "#2563eb" : "white",
                                               border: !!formData.selected_universal_signals[s.label] ? "none" : "1px solid #cbd5e1",
                                               display:"flex", alignItems:"center", justifyContent:"center", color:"white", fontSize: 14
                                           }}>
                                               {!!formData.selected_universal_signals[s.label] && "✓"}
                                           </div>
                                            {/* Hidden checkbox for logic */}
                                            <input 
                                                type="checkbox" 
                                                style={{display:"none"}}
                                                checked={!!formData.selected_universal_signals[s.label]} 
                                                onChange={()=>toggleSignal(s.label)} 
                                            />
                                            <span style={{fontSize: 14, fontWeight: 500, color:"#1e293b"}}>{s.label}</span>
                                            <RiskBadge risk={s.risk} />
                                        </label>
                                    ))}
                               </div>
                           </div>

                           {/* Universal Section */}
                           <div style={{border:"1px solid #e2e8f0", borderRadius: 8, overflow:"hidden", background: "white"}}>
                               <div style={{padding: "12px 16px", borderBottom: "1px solid #e2e8f0", background: "#f8fafc", display:"flex", justifyContent:"space-between", alignItems:"center"}}>
                                   <div style={{fontWeight: 700, fontSize: 14, color: "#334155"}}>Universal Signals</div>
                                   <div style={{display:"flex", gap: 12, fontSize: 13}}>
                                        <button 
                                            onClick={() => {
                                                const updates = {};
                                                UNIVERSAL_SIGNALS.forEach(s => updates[s.label] = true);
                                                setFormData(prev => ({...prev, selected_universal_signals: {...prev.selected_universal_signals, ...updates}}));
                                            }}
                                            style={{background:"none", border:"none", color:"#2563eb", cursor:"pointer", fontWeight: 500}}
                                        >
                                            Select All
                                        </button>
                                        <span style={{color:"#cbd5e1"}}>|</span>
                                        <button 
                                            onClick={() => {
                                                const updates = {};
                                                UNIVERSAL_SIGNALS.forEach(s => updates[s.label] = false);
                                                setFormData(prev => ({...prev, selected_universal_signals: {...prev.selected_universal_signals, ...updates}}));
                                            }}
                                            style={{background:"none", border:"none", color:"#2563eb", cursor:"pointer", fontWeight: 500}}
                                        >
                                            Clear
                                        </button>
                                   </div>
                               </div>
                               <div>
                                    {UNIVERSAL_SIGNALS.map((s, idx) => (
                                        <label key={s.label} style={{
                                            display:"flex", alignItems:"center", gap: 12, padding: "12px 16px", cursor: "pointer",
                                            borderBottom: idx < UNIVERSAL_SIGNALS.length - 1 ? "1px solid #f1f5f9" : "none",
                                            background: "white"
                                        }}>
                                           <div style={{
                                               width: 20, height: 20, borderRadius: 4, 
                                               background: !!formData.selected_universal_signals[s.label] ? "#ef4444" : "white", // Red check for universal per image implies style? Image shows check icons. 
                                               // Actually image has blue checks for Recommended and RED checks for Universal? 
                                               // Wait, looking closely at image:
                                               // Recommended -> Blue checks
                                               // Universal -> Red checks
                                               // Let's implement that.
                                               border: !!formData.selected_universal_signals[s.label] ? "none" : "1px solid #cbd5e1",
                                               display:"flex", alignItems:"center", justifyContent:"center", color:"white", fontSize: 14
                                           }}>
                                               {!!formData.selected_universal_signals[s.label] && "✓"}
                                           </div>
                                            <input 
                                                type="checkbox" 
                                                style={{display:"none"}}
                                                checked={!!formData.selected_universal_signals[s.label]} 
                                                onChange={()=>toggleSignal(s.label)} 
                                            />
                                            <span style={{fontSize: 14, fontWeight: 500, color:"#1e293b"}}>{s.label}</span>
                                            <RiskBadge risk={s.risk} />
                                        </label>
                                    ))}
                               </div>
                           </div>
                           
                           <div style={{textAlign:"right", marginTop: 12, fontSize: 13, color: "#64748b", fontWeight: 500}}>
                                Selected: <strong style={{color:"#0f172a"}}>{Object.values(formData.selected_universal_signals).filter(Boolean).length}</strong> / {activeRecommendedSignals.length + UNIVERSAL_SIGNALS.length} signals
                           </div>

                        </div>
                    )}


                    {/* --- STEP 3: Routes (Previously Step 4) --- */}
                    {step === 3 && (
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
                                                <select 
                                                    style={{...inputStyle, width: 80}}
                                                    value={formData.whatsapp_codes?.[i] || "+1"}
                                                    onChange={e => handleArrayUpdate("whatsapp_codes", i, e.target.value)}
                                                >
                                                    {EXT_COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.code} {c.flag}</option>)}
                                                </select>
                                                <input 
                                                    style={{...inputStyle, flex:1, width: "auto"}} 
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
                             {PLAN_FEATURES.slack_integration && (
                                <div style={{padding: 20, background: "#fff", border:"1px solid #e2e8f0", borderRadius: 10}}>
                                    <label style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom: formData.slack_enabled ? 16 : 0}}>
                                        <div style={{fontWeight: 600}}>
                                            Slack Alerts 
                                        </div>
                                        <input type="checkbox" checked={formData.slack_enabled} onChange={e=>update("slack_enabled", e.target.checked)} />
                                    </label>
                                    
                                    {formData.slack_enabled && (
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
                             )}

                            {/* Routing */}
                             <div style={{padding: 20, background:"#fff", border:"1px solid #e2e8f0", borderRadius: 10}}>
                                 <h4 style={{marginTop:0, marginBottom:16}}>Routing Logic</h4>
                                 
                                 <div style={{display:"grid", gap: 16}}>
                                     <div style={{display:"grid", gridTemplateColumns:"100px 1fr", alignItems:"center"}}>
                                         <span style={{color:"#ef4444", fontWeight:600}}>High Risk</span>
                                         <div style={{display:"flex", gap: 16}}>
                                              {["whatsapp","slack","digest"].map(c => (
                                                  (c !== "slack" || PLAN_FEATURES.slack_integration) && (
                                                      <label key={c} style={{display:"flex", gap: 6, alignItems:"center", fontSize:13, textTransform:"capitalize", opacity: ((c==="whatsapp" && !formData.whatsapp_enabled) || (c==="slack" && (!formData.slack_enabled))) ? 0.5 : 1}}>
                                                          <input type="checkbox" 
                                                            checked={formData.routing_high.includes(c)} 
                                                            onChange={()=>toggleRouting("high", c)}
                                                            disabled={(c==="whatsapp" && !formData.whatsapp_enabled) || (c==="slack" && (!formData.slack_enabled))}
                                                          />
                                                          {c}
                                                      </label>
                                                  )
                                              ))}
                                         </div>
                                     </div>
                                     
                                     <div style={{display:"grid", gridTemplateColumns:"100px 1fr", alignItems:"center"}}>
                                         <span style={{color:"#f59e0b", fontWeight:600}}>Medium</span>
                                         <div style={{display:"flex", gap: 16}}>
                                              {["whatsapp","slack","digest"].map(c => (
                                                  (c !== "slack" || PLAN_FEATURES.slack_integration) && (
                                                      <label key={c} style={{display:"flex", gap: 6, alignItems:"center", fontSize:13, textTransform:"capitalize", opacity: ((c==="whatsapp" && !formData.whatsapp_enabled) || (c==="slack" && (!formData.slack_enabled))) ? 0.5 : 1}}>
                                                          <input type="checkbox" 
                                                            checked={formData.routing_medium.includes(c)} 
                                                            onChange={()=>toggleRouting("medium", c)}
                                                            disabled={(c==="whatsapp" && !formData.whatsapp_enabled) || (c==="slack" && (!formData.slack_enabled))}
                                                          />
                                                          {c}
                                                      </label>
                                                  )
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

                    {/* --- STEP 4: Connect Inbox (Previously Step 2) --- */}
                    {step === 4 && (
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
                                                disabled={!!mailboxId} 
                                            />
                                            {/* Green Check if returning from oauth with mailboxId set */}
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
                            
                            {/* Terms Checkbox removed (now in modal) */}

                             {/* Success Message AFTER connecting */}
                            {mailboxId && (
                                <div style={{background:"#ecfdf5", padding: 16, borderRadius: 8, color:"#065f46", fontSize: 14}}>
                                    <strong>Connected successfully.</strong> Your inboxes are authorized. Click Next to review.
                                </div>
                            )}
                        </div>
                    )}
                    
                    {/* --- STEP 5 --- */}
                    {step === 5 && (
                        <div style={{display:"grid", gap: 20}}>
                            <div style={{background:"#f8fafc", padding: 20, borderRadius: 10, display:"grid", gap: 12}}>
                                <Row label="Company" val={formData.company_name} />
                                <Row label="Business" val={formData.business_type} />
                                <div style={{display:"flex", justifyContent:"space-between", borderBottom:"1px solid #e2e8f0", paddingBottom: 8}}>
                                    <span style={{color:"#64748b", fontSize: 13}}>Signals Configured</span>
                                    <div style={{display:"flex", alignItems:"center", gap:8}}>
                                        <span style={{fontWeight: 500, fontSize: 13, textAlign:"right"}}>
                                            {Object.values(formData.selected_universal_signals).filter(Boolean).length} Active
                                        </span>
                                        <button onClick={()=>setStep(2)} style={{border:"none", background:"none", color:"#2563eb", cursor:"pointer", fontSize:12, textDecoration:"underline"}}>Edit</button>
                                    </div>
                                </div>
                                <Row label="Alerts" val={formData.whatsapp_enabled ? "WhatsApp Enabled" : "No Instant Alerts"} />
                                <Row label="Digest" val={formData.digest_enabled ? `Daily at ${formData.digest_time}` : "Disabled"} />
                                <Row label="Inboxes" val={formData.monitored_addresses.join(", ")} />
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
                        disabled={step === 1} 
                        style={{...secondaryBtn, opacity: step === 1 ? 0.5 : 1}}
                    >
                        Back
                    </button>
                    
                    {/* Button Logic Updates for Step 4 */}
                    {step === 4 && !mailboxId ? (
                         <button onClick={handleConnectClick} disabled={loading} style={primaryBtn}>
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

function RiskBadge({risk}) {
    if(risk === 'high') {
         return <span style={{fontSize: 11, fontWeight: 600, color:"white", background:"#ef4444", padding:"2px 8px", borderRadius: 4}}>High Risk</span>;
    }
    if(risk === 'medium') {
         return <span style={{fontSize: 11, fontWeight: 600, color:"#78350f", background:"#fcd34d", padding:"2px 8px", borderRadius: 4}}>Medium Risk</span>;
    }
    return null;
}

