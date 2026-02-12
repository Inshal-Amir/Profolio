import React,{useEffect,useState} from "react";
import { useSearchParams, Link } from "react-router-dom";
import { getJSON } from "../lib/api.js";
import "./ConnectInboxResponsive.css";

export default function Success(){
  const [sp]=useSearchParams();
  const mailbox_id=sp.get("mailbox_id")||"";
  const [mailbox,setMailbox]=useState(null);

  useEffect(()=>{
    let alive=true;
    async function run(){
      if(!mailbox_id) return;
      try{
        const out=await getJSON(`/api/mailbox?mailbox_id=${encodeURIComponent(mailbox_id)}`);
        if(alive) setMailbox(out.mailbox||null);
      }catch{
        if(alive) setMailbox(null);
      }
    }
    run();
    return ()=>{ alive=false; };
  },[mailbox_id]);

  return (
    <div className="auth-container" style={{maxWidth:560,margin:"40px auto",padding:16,fontFamily:"system-ui"}}>
      <h1 style={{marginBottom:6}}>Inbox connected ✅</h1>
      <p style={{marginTop:0,opacity:.85}}>
        Next: message <b>START</b> on WhatsApp to enable alerts.
      </p>

      {mailbox?(
        <div className="status-box" style={{border:"1px solid #ddd",borderRadius:10,padding:12,marginTop:12}}>
          <div style={{fontSize:12,opacity:.7}}>Mailbox</div>
          <div style={{fontWeight:600}}>{mailbox.mailbox_address||"(unknown)"}</div>
          <div style={{fontSize:12,opacity:.7}}>Provider: {mailbox.provider||"unknown"}</div>
          <div style={{fontSize:12,opacity:.7}}>Status: {mailbox.status||"unknown"}</div>
        </div>
      ):null}

      <div className="button-grid" style={{marginTop:16,display:"flex",gap:10}}>
        <Link to="/onboarding" style={{padding:"10px 12px",borderRadius:10,border:"1px solid #ccc",textDecoration:"none"}}>
          Onboard another test client
        </Link>
      </div>

      <div style={{marginTop:14,fontSize:12,opacity:.7}}>
        Alerts won’t send until START is received.
      </div>
    </div>
  );
}
