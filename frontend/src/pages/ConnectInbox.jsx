import React,{useEffect,useState} from "react";
import { useSearchParams } from "react-router-dom";
import { getJSON } from "../lib/api.js";
import "./ConnectInboxResponsive.css";

export default function ConnectInbox(){
  const [sp]=useSearchParams();
  const mailbox_id=sp.get("mailbox_id")||"";
  const [mailbox,setMailbox]=useState(null);
  const [err,setErr]=useState("");

  useEffect(()=>{
    let alive=true;
    async function run(){
      setErr("");
      if(!mailbox_id){
        setErr("Missing mailbox_id in URL.");
        return;
      }
      try{
        const out=await getJSON(`/api/mailbox?mailbox_id=${encodeURIComponent(mailbox_id)}`);
        if(alive) setMailbox(out.mailbox||null);
      }catch(ex){
        if(alive) setErr(ex.message||"Failed to load mailbox.");
      }
    }
    run();
    return ()=>{ alive=false; };
  },[mailbox_id]);

  function go(provider){
    if(!mailbox_id) return;
    if(provider==="google"){
      window.location.href=(import.meta.env.VITE_API_BASE||"")+
        `/api/oauth/google/start?mailbox_id=${encodeURIComponent(mailbox_id)}`;
    }else{
      window.location.href=(import.meta.env.VITE_API_BASE||"")+
        `/api/oauth/microsoft/start?mailbox_id=${encodeURIComponent(mailbox_id)}`;
    }
  }

  return (
    <div className="auth-container" style={{maxWidth:560,margin:"40px auto",padding:16,fontFamily:"system-ui"}}>
      <h1 style={{marginBottom:6}}>Connect your inbox</h1>
      <p style={{marginTop:0,opacity:.8}}>
        MailWise will monitor high-risk emails and alert you on WhatsApp. We never ask for your email password.
      </p>

      {err?(
        <div style={{background:"#fee",border:"1px solid #f99",padding:10,borderRadius:8,marginBottom:12}}>
          {err}
        </div>
      ):null}

      {mailbox?(
        <div className="status-box" style={{border:"1px solid #ddd",borderRadius:10,padding:12,marginBottom:14}}>
          <div style={{fontSize:12,opacity:.7}}>Connecting mailbox</div>
          <div style={{fontWeight:600}}>{mailbox.mailbox_address||"(unknown)"}</div>
          <div style={{fontSize:12,opacity:.7}}>Status: {mailbox.status||"unknown"}</div>
        </div>
      ):null}

      <div className="button-grid" style={{display:"grid",gap:10}}>
        <button onClick={()=>go("google")} style={{padding:"10px 12px",borderRadius:10,border:"1px solid #ccc"}}>
          Connect Gmail (Google Workspace)
        </button>
        <button onClick={()=>go("microsoft")} style={{padding:"10px 12px",borderRadius:10,border:"1px solid #ccc"}}>
          Connect Outlook (Microsoft 365)
        </button>
      </div>

      <div style={{marginTop:14,fontSize:12,opacity:.7}}>
        After connecting, you’ll see a success page with the next step: message START on WhatsApp.
      </div>
    </div>
  );
}
