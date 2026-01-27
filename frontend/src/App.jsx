import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import Onboarding from "./pages/Onboarding.jsx";
import ConnectInbox from "./pages/ConnectInbox.jsx";
import Success from "./pages/Success.jsx";
import NotFound from "./pages/NotFound.jsx";

export default function App(){
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/onboarding" replace/>}/>
      <Route path="/onboarding" element={<Onboarding/>}/>
      <Route path="/connect" element={<ConnectInbox/>}/>
      <Route path="/success" element={<Success/>}/>
      <Route path="*" element={<NotFound/>}/>
    </Routes>
  );
}
