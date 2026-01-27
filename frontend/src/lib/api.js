
const API_BASE = import.meta.env.VITE_API_BASE || "/api";
const BACKEND_ORIGIN=import.meta.env.VITE_BACKEND_ORIGIN||"";

async function readJson(res){
  const json=await res.json().catch(()=>null);
  return json;
}
function buildErrorMessage(res,json){
  if(json&&json.missing&&Array.isArray(json.missing)&&json.missing.length){
    return `${json.error||"Request failed"}: ${json.missing.join(", ")}`;
  }
  if(json&&json.error) return json.error;
  return `Request failed (${res.status})`;
}

export async function postJSON(path,data){
  const res=await fetch(API_BASE+path,{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify(data)
  });
  const json=await readJson(res);
  if(!res.ok) throw new Error(buildErrorMessage(res,json));
  return json;
}

export async function getJSON(path){
  const res=await fetch(API_BASE+path,{method:"GET"});
  const json=await readJson(res);
  if(!res.ok) throw new Error(buildErrorMessage(res,json));
  return json;
}

// ✅ use this ONLY for OAuth redirect (browser navigation)
export function backendRedirectUrl(path){
  return `${BACKEND_ORIGIN}${path}`;
}
