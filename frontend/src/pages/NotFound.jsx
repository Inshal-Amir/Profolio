import React from "react";
import { Link } from "react-router-dom";

export default function NotFound(){
  return (
    <div style={{maxWidth:560,margin:"40px auto",padding:16,fontFamily:"system-ui"}}>
      <h1>404</h1>
      <p>Page not found.</p>
      <Link to="/onboarding">Go to onboarding</Link>
    </div>
  );
}
