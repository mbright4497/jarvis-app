import { useState, useRef, useEffect } from "react";

const GHL_WEBHOOK = "https://services.leadconnectorhq.com/hooks/D1dTmgY5G8SuVs91hoBJ/webhook-trigger/0e2f8ae2-2470-43d5-ab40-c86a8c17d2df";
const ANTHROPIC_KEY = import.meta.env.VITE_ANTHROPIC_KEY;

const BASE_SYSTEM_PROMPT = `You are J.A.R.V.I.S. — Matthew Bright's personal business intelligence system. Matthew is the CEO of ClosingPilot (real estate tech SaaS), HubLinkPro, and Open Claw.

Personality: Sharp, confident, direct. Think like a McKinsey strategist + growth marketer + senior engineer + ops builder. No fluff. Lead with the answer.

Capabilities: emails, SOPs, strategy, ClosingPilot product, Facebook Ads, revenue analysis, AI automation (GHL/OpenClaw), TypeScript/Next.js code review, Supabase debugging.

Format: Lead with answer, then reasoning. SOPs = numbered steps. Strategy = recommendation first.

TOOLS AVAILABLE — YOU HAVE EXACTLY TWO TOOLS:
1. send_email — fires a real email through GHL. Fully connected and working.
2. trigger_ghl — adds contacts or triggers GHL automations.

EMAIL RULES — NON-NEGOTIABLE:
- You have a send_email tool. It works. Use it.
- NEVER write email content as plain text in your response under any circumstances.
- When Matthew asks to send, draft, write, or compose an email: call send_email immediately.
- Required: first_name, last_name, email, subject, body. If email address is missing, ask once. Then call the tool.
- After calling send_email, confirm briefly: "Email queued — hit Send via GHL to fire it."
- Do NOT explain the tool. Do NOT say it is unavailable. It is available. Call it.`;

const EXTRACT_PROMPT = `Extract key business facts from this message. Return ONLY valid JSON:
{"hasNewFacts":true/false,"facts":[{"key":"short_key","value":"fact","category":"revenue|clients|products|team|decisions|goals|other"}]}
Extract: MRR/ARR, client names, team, product status, dates, decisions, goals. Ignore greetings/questions.`;

const TOOLS = [
  {
    name: "send_email",
    description: "Send a real email via GHL. Use when Matthew asks to send, write, or compose an email.",
    input_schema: {
      type: "object",
      properties: {
        first_name: { type: "string" },
        last_name:  { type: "string" },
        email:      { type: "string" },
        phone:      { type: "string" },
        subject:    { type: "string" },
        body:       { type: "string" }
      },
      required: ["first_name", "last_name", "email", "subject", "body"]
    }
  },
  {
    name: "trigger_ghl",
    description: "Add a contact or trigger a non-email GHL automation.",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["add_contact", "create_task", "log_deal", "trigger_workflow"] },
        data:   { type: "object" }
      },
      required: ["action", "data"]
    }
  }
];

const isEmailIntent = (text) => /\b(email|send|compose|write.*to|message.*to|draft)\b/i.test(text);

const QUICK_ACTIONS = [
  { id: "email",       label: "Send Email",   icon: "✉", prompt: "Help me send an email. Ask me who it's to and what I need to say." },
  { id: "ghl",         label: "Add to GHL",   icon: "⚡", prompt: "I want to add a contact to GoHighLevel. Ask me for their details." },
  { id: "strategy",    label: "Strategy",     icon: "♟", prompt: "Let's work through a strategic decision. Ask me what I'm weighing." },
  { id: "closingpilot",label: "ClosingPilot", icon: "🏠", prompt: "Let's work on ClosingPilot. Ask me what I need — product, feature, code, or workflow." },
  { id: "revenue",     label: "Revenue",      icon: "💰", prompt: "Let's analyze revenue or financials. Ask me what to focus on." },
  { id: "sop",         label: "Build SOP",    icon: "📋", prompt: "Help me build a Standard Operating Procedure. Ask me what process we're documenting." },
];

const storage = {
  get: (key) => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
  set: (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} },
};

const callClaude = (body) => fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
  body: JSON.stringify(body)
}).then(r => r.json());

const TypingDots = () => (
  <div style={{ display:"flex", alignItems:"center", gap:5, padding:"10px 14px", background:"rgba(255,255,255,0.04)", borderRadius:12, width:"fit-content", border:"0.5px solid rgba(255,255,255,0.08)" }}>
    {[0,1,2].map(i => <div key={i} style={{ width:7, height:7, borderRadius:"50%", background:"#C8A84B", animation:"pulse 1.2s ease-in-out infinite", animationDelay:`${i*0.2}s` }}/>)}
  </div>
);

const ToolBadge = ({ name, status }) => {
  const map = { send_email:["#534AB7","#EEEDFE","✉ Preparing email"], trigger_ghl:["#993C1D","#FAECE7","⚡ Triggering GHL"] };
  const [fg, bg, label] = map[name] || ["#5F5E5A","#F1EFE8", name];
  return (
    <div style={{ display:"inline-flex", alignItems:"center", gap:6, padding:"4px 10px", background:bg, borderRadius:20, fontSize:11, color:fg, fontWeight:500, margin:"4px 0", border:`0.5px solid ${fg}33` }}>
      {label} {status === "running" ? "..." : "✓"}
    </div>
  );
};

const EmailCard = ({ first_name, last_name, email, phone, subject, body }) => {
  const [ghlStatus, setGhlStatus] = useState("ready");
  const [copied, setCopied]       = useState(false);
  const displayName = [first_name, last_name].filter(Boolean).join(" ");

  const fireGHL = async () => {
    setGhlStatus("sending");
    try {
      const payload = { first_name, last_name, email, subject, body };
      if (phone) payload.phone = phone;
      const res = await fetch(GHL_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      setGhlStatus(data.success !== false ? "sent" : "error");
    } catch { setGhlStatus("error"); }
  };

  const copyPayload = () => {
    navigator.clipboard.writeText(JSON.stringify({ first_name, last_name, email, phone, subject, body }, null, 2));
    setCopied(true); setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div style={{ background:"rgba(83,74,183,0.08)", border:"0.5px solid rgba(83,74,183,0.3)", borderRadius:10, padding:"12px 14px", marginTop:8 }}>
      <div style={{ fontSize:10, color:"#7F77DD", letterSpacing:"0.08em", fontWeight:600, marginBottom:8 }}>EMAIL → GHL</div>
      <div style={{ fontSize:12, color:"#999", marginBottom:2 }}>To: <span style={{ color:"#D4CEBE" }}>{displayName} {email ? `<${email}>` : ""}</span></div>
      <div style={{ fontSize:12, color:"#999", marginBottom:8 }}>Subject: <span style={{ color:"#D4CEBE", fontWeight:500 }}>{subject}</span></div>
      <div style={{ fontSize:12, color:"#C0BAB0", lineHeight:1.7, whiteSpace:"pre-wrap", borderTop:"0.5px solid rgba(255,255,255,0.06)", paddingTop:8 }}>{body}</div>
      <div style={{ display:"flex", gap:8, marginTop:10, flexWrap:"wrap" }}>
        <button onClick={fireGHL} disabled={ghlStatus==="sending"||ghlStatus==="sent"}
          style={{ padding:"6px 12px", background:ghlStatus==="sent"?"rgba(74,222,128,0.15)":"rgba(200,168,75,0.15)", border:`0.5px solid ${ghlStatus==="sent"?"rgba(74,222,128,0.4)":"rgba(200,168,75,0.35)"}`, borderRadius:8, color:ghlStatus==="sent"?"#4ADE80":"#C8A84B", fontSize:11, cursor:"pointer" }}>
          {ghlStatus==="sent" ? "✓ Sent via GHL" : ghlStatus==="sending" ? "Firing..." : ghlStatus==="error" ? "✕ Failed — retry" : "⚡ Fire to GHL"}
        </button>
        <a href={`mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}
          style={{ padding:"6px 12px", background:"rgba(83,74,183,0.12)", border:"0.5px solid rgba(127,119,221,0.3)", borderRadius:8, color:"#AFA9EC", fontSize:11, textDecoration:"none" }}>
          Open in Mail
        </a>
        <button onClick={copyPayload}
          style={{ padding:"6px 12px", background:"rgba(255,255,255,0.03)", border:"0.5px solid rgba(255,255,255,0.1)", borderRadius:8, color:copied?"#4ADE80":"#666", fontSize:11, cursor:"pointer" }}>
          {copied ? "✓ Copied" : "Copy payload"}
        </button>
      </div>
    </div>
  );
};

const GHLCard = ({ action, data }) => {
  const [sent, setSent] = useState(false);
  const labels = { add_contact:"Add Contact", create_task:"Create Task", log_deal:"Log Deal", trigger_workflow:"Trigger Workflow" };
  const fire = async () => {
    try {
      await fetch(GHL_WEBHOOK, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ action, ...data }) });
      setSent(true);
    } catch { alert("GHL webhook failed."); }
  };
  return (
    <div style={{ background:"rgba(153,60,29,0.08)", border:"0.5px solid rgba(153,60,29,0.3)", borderRadius:10, padding:"12px 14px", marginTop:8 }}>
      <div style={{ fontSize:10, color:"#D85A30", letterSpacing:"0.08em", marginBottom:8, fontWeight:600 }}>GHL · {labels[action]||action}</div>
      <pre style={{ fontSize:11, color:"#C0BAB0", background:"rgba(0,0,0,0.2)", borderRadius:6, padding:"8px 10px", overflowX:"auto", margin:"0 0 10px" }}>{JSON.stringify(data,null,2)}</pre>
      {sent ? <div style={{ fontSize:12, color:"#4ADE80" }}>✓ Fired</div>
             : <button onClick={fire} style={{ padding:"6px 14px", background:"rgba(153,60,29,0.2)", border:"0.5px solid rgba(216,90,48,0.4)", borderRadius:8, color:"#F0997B", fontSize:11, cursor:"pointer" }}>Fire to GHL →</button>}
    </div>
  );
};

const MemoryPanel = ({ memories, onDelete, onClose }) => (
  <div style={{ position:"absolute", top:0, right:0, bottom:0, width:260, background:"#111113", borderLeft:"0.5px solid rgba(255,255,255,0.1)", zIndex:10, display:"flex", flexDirection:"column" }}>
    <div style={{ padding:"12px 14px", borderBottom:"0.5px solid rgba(255,255,255,0.07)", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
      <div style={{ fontSize:12, fontWeight:600, color:"#C8A84B" }}>MEMORY <span style={{ fontSize:10, color:"#555" }}>({memories.length})</span></div>
      <button onClick={onClose} style={{ background:"none", border:"none", color:"#555", cursor:"pointer", fontSize:16 }}>✕</button>
    </div>
    <div style={{ flex:1, overflowY:"auto", padding:"10px 14px" }}>
      {memories.length === 0
        ? <div style={{ color:"#333", fontSize:11, textAlign:"center", marginTop:30 }}>No memories yet.</div>
        : Object.entries(memories.reduce((a,m)=>{ (a[m.category]=a[m.category]||[]).push(m); return a; },{})).map(([cat,items])=>(
          <div key={cat} style={{ marginBottom:12 }}>
            <div style={{ fontSize:9, color:"#C8A84B", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:4 }}>{cat}</div>
            {items.map((m,i)=>(
              <div key={i} style={{ background:"rgba(255,255,255,0.03)", border:"0.5px solid rgba(255,255,255,0.06)", borderRadius:6, padding:"6px 8px", marginBottom:4, display:"flex", justifyContent:"space-between", gap:6 }}>
                <div><div style={{ fontSize:9, color:"#555" }}>{m.key}</div><div style={{ fontSize:11, color:"#B0A990" }}>{m.value}</div></div>
                <button onClick={()=>onDelete(m.key)} style={{ background:"none", border:"none", color:"#333", cursor:"pointer", fontSize:12 }}>✕</button>
              </div>
            ))}
          </div>
        ))
      }
    </div>
  </div>
);

export default function App() {
  const [messages,     setMessages]     = useState([]);
  const [input,        setInput]        = useState("");
  const [loading,      setLoading]      = useState(false);
  const [memories,     setMemories]     = useState([]);
  const [panel,        setPanel]        = useState(null);
  const [savingMemory, setSavingMemory] = useState(false);
  const [activeTools,  setActiveTools]  = useState([]);
  const bottomRef = useRef(null);

  useEffect(() => {
    const saved = storage.get("jarvis_memories") || [];
    setMemories(saved);
    setMessages([{ role:"assistant", content: saved.length > 0
      ? `J.A.R.V.I.S. online. ${saved.length} memories loaded. GHL wired to iHome Realty. What are we executing today, Matthew?`
      : `J.A.R.V.I.S. online. GHL Email Sender live. What's the first move, Matthew?`
    }]);
  }, []);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:"smooth" }); }, [messages, loading]);

  const saveMemories = (mem) => { setMemories(mem); storage.set("jarvis_memories", mem); };
  const deleteMemory = (key) => saveMemories(memories.filter(m => m.key !== key));

  const buildSystemPrompt = () => {
    if (!memories.length) return BASE_SYSTEM_PROMPT;
    const block = memories.map(m=>`[${m.category.toUpperCase()}] ${m.key}: ${m.value}`).join("\n");
    return `${BASE_SYSTEM_PROMPT}\n\n--- MATTHEW'S MEMORY ---\n${block}\n--- END MEMORY ---`;
  };

  const extractFacts = async (msg) => {
    try {
      const data = await callClaude({ model:"claude-sonnet-4-5", max_tokens:400,
        messages:[{ role:"user", content:`${EXTRACT_PROMPT}\n\nMessage: "${msg}"` }] });
      const parsed = JSON.parse(data.content?.map(b=>b.text||"").join("").replace(/```json|```/g,"").trim());
      if (parsed.hasNewFacts && parsed.facts?.length > 0) {
        const updated = [...memories];
        for (const f of parsed.facts) { const i = updated.findIndex(m=>m.key===f.key); i>=0?updated[i]=f:updated.push(f); }
        saveMemories(updated);
        return parsed.facts.length;
      }
    } catch {}
    return 0;
  };

  const composeEmail = async (userText) => {
    setActiveTools([{ name:"send_email", status:"running" }]);
    try {
      const ctx = memories.length ? `\nContext: ${memories.map(m=>`${m.key}: ${m.value}`).join(", ")}` : "";
      const data = await callClaude({ model:"claude-sonnet-4-5", max_tokens:600,
        messages:[{ role:"user", content:
          `You are an email composer for Matthew Bright, CEO of ClosingPilot.${ctx}
Extract fields and return ONLY valid JSON — no other text:
{"first_name":"","last_name":"","email":"","subject":"","body":"","missing_email":false}
If no email address provided, set missing_email:true. Write complete professional body, sign as Matthew.
Request: "${userText}"` }] });
      const raw = data.content?.map(b=>b.text||"").join("").replace(/```json|```/g,"").trim();
      const parsed = JSON.parse(raw);
      setActiveTools([{ name:"send_email", status:"done" }]);
      return parsed;
    } catch { setActiveTools([]); return null; }
  };

  const sendMessage = async (text) => {
    const userText = text || input.trim();
    if (!userText || loading) return;
    setInput("");
    setActiveTools([]);
    const newMessages = [...messages, { role:"user", content:userText }];
    setMessages(newMessages);
    setLoading(true);

    extractFacts(userText).then(n => { if (n>0) { setSavingMemory(true); setTimeout(()=>setSavingMemory(false),2500); }});

    if (isEmailIntent(userText)) {
      const emailData = await composeEmail(userText);
      if (emailData?.missing_email) {
        setMessages(prev=>[...prev,{ role:"assistant", content:"What's the recipient's email address? I have everything else ready." }]);
      } else if (emailData?.email) {
        setMessages(prev=>[...prev,{ role:"assistant", content:"Email queued — hit Fire to GHL to send it.", emailDrafts:[emailData], ghlActions:[] }]);
      } else {
        setMessages(prev=>[...prev,{ role:"assistant", content:"I couldn't compose that email. Can you give me more details?" }]);
      }
      setActiveTools([]); setLoading(false); return;
    }

    try {
      const apiMessages = newMessages.map(m=>({ role:m.role, content:m.content }));
      const data = await callClaude({ model:"claude-sonnet-4-5", max_tokens:1000,
        system: buildSystemPrompt(), tools:TOOLS, tool_choice:{type:"auto"}, messages:apiMessages });

      if (data.error) { setMessages(prev=>[...prev,{role:"assistant",content:`Error: ${data.error.message}`}]); setLoading(false); return; }

      const toolBlocks = data.content?.filter(b=>b.type==="tool_use")||[];
      const textReply  = data.content?.filter(b=>b.type==="text").map(b=>b.text).join("")||"";

      if (!toolBlocks.length) {
        setMessages(prev=>[...prev,{role:"assistant",content:textReply||"No response."}]);
      } else {
        const emailDrafts=[]; const ghlActions=[];
        const toolResults = await Promise.all(toolBlocks.map(async block => {
          if (block.name==="send_email")  emailDrafts.push(block.input);
          if (block.name==="trigger_ghl") ghlActions.push(block.input);
          return { type:"tool_result", tool_use_id:block.id, content:JSON.stringify({success:true}) };
        }));
        const data2 = await callClaude({ model:"claude-sonnet-4-5", max_tokens:1000,
          system:buildSystemPrompt(), tools:TOOLS, tool_choice:{type:"auto"},
          messages:[...apiMessages,{role:"assistant",content:data.content},{role:"user",content:toolResults}] });
        const final = data2.content?.filter(b=>b.type==="text").map(b=>b.text).join("")||"Done.";
        setMessages(prev=>[...prev,{role:"assistant",content:final,emailDrafts,ghlActions}]);
      }
    } catch(e) { setMessages(prev=>[...prev,{role:"assistant",content:`Error: ${e.message}`}]); }
    setActiveTools([]); setLoading(false);
  };

  const handleKey = (e) => { if (e.key==="Enter"&&!e.shiftKey){ e.preventDefault(); sendMessage(); }};

  const fmt = (text) => text.split("\n").map((line,i)=>{
    if (line.startsWith("**")&&line.endsWith("**")) return <p key={i} style={{margin:"8px 0 4px",fontWeight:600,color:"#C8A84B",fontSize:12,letterSpacing:"0.04em",textTransform:"uppercase"}}>{line.replace(/\*\*/g,"")}</p>;
    if (line.match(/^\d+\.\s/)) return <p key={i} style={{margin:"3px 0",paddingLeft:4}}>{line}</p>;
    if (line.startsWith("- ")||line.startsWith("• ")) return <p key={i} style={{margin:"3px 0",paddingLeft:12,borderLeft:"2px solid rgba(200,168,75,0.3)"}}>{line.replace(/^[-•]\s/,"")}</p>;
    if (line==="") return <div key={i} style={{height:6}}/>;
    return <p key={i} style={{margin:"2px 0"}}>{line}</p>;
  });

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100vh",background:"#0D0D0F",color:"#E8E3D9",fontFamily:"'DM Sans','Segoe UI',sans-serif",position:"relative",overflow:"hidden"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap');
        @keyframes pulse{0%,100%{opacity:.3;transform:scale(.8)}50%{opacity:1;transform:scale(1)}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        @keyframes slideIn{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:translateX(0)}}
        @keyframes memSave{0%{opacity:0}20%{opacity:1}80%{opacity:1}100%{opacity:0}}
        ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:#2a2a2e;border-radius:4px}
        textarea{resize:none;font-family:inherit}textarea:focus{outline:none}
        .qbtn:hover{background:rgba(200,168,75,0.12)!important;border-color:rgba(200,168,75,0.4)!important;color:#C8A84B!important}
        .hbtn:hover{background:rgba(255,255,255,0.06)!important}
        .send-btn:hover{background:rgba(200,168,75,0.9)!important}.send-btn:active{transform:scale(0.96)}
      `}</style>

      <div style={{padding:"10px 14px",borderBottom:"0.5px solid rgba(255,255,255,0.07)",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:30,height:30,borderRadius:"50%",background:"linear-gradient(135deg,#C8A84B,#8B6914)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,color:"#0D0D0F"}}>J</div>
          <div>
            <div style={{fontSize:13,fontWeight:600,letterSpacing:"0.06em"}}>J.A.R.V.I.S.</div>
            <div style={{fontSize:9,color:"#C8A84B",letterSpacing:"0.08em",fontFamily:"'DM Mono',monospace"}}>
              {memories.length>0?`${memories.length} MEM · `:""}EMAIL · GHL · MEMORY
            </div>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          {savingMemory&&<div style={{fontSize:9,color:"#C8A84B",animation:"memSave 2.5s ease forwards",fontFamily:"'DM Mono',monospace"}}>⚡ SAVED</div>}
          <button className="hbtn" onClick={()=>setPanel(panel==="memory"?null:"memory")}
            style={{padding:"4px 8px",background:"rgba(255,255,255,0.03)",border:"0.5px solid rgba(255,255,255,0.1)",borderRadius:6,color:panel==="memory"?"#C8A84B":"#555",fontSize:10,cursor:"pointer",fontFamily:"'DM Mono',monospace",transition:"all 0.15s"}}>
            MEM ({memories.length})
          </button>
          <div style={{width:6,height:6,borderRadius:"50%",background:"#4ADE80",boxShadow:"0 0 6px rgba(74,222,128,0.5)"}}/>
        </div>
      </div>

      <div style={{padding:"7px 12px",borderBottom:"0.5px solid rgba(255,255,255,0.05)",display:"flex",gap:5,overflowX:"auto",flexShrink:0}}>
        {QUICK_ACTIONS.map(a=>(
          <button key={a.id} className="qbtn" onClick={()=>sendMessage(a.prompt)}
            style={{padding:"4px 10px",background:"rgba(255,255,255,0.03)",border:"0.5px solid rgba(255,255,255,0.08)",borderRadius:20,color:"#888",fontSize:11,cursor:"pointer",whiteSpace:"nowrap",transition:"all 0.15s",fontFamily:"inherit"}}>
            {a.icon} {a.label}
          </button>
        ))}
      </div>

      <div style={{flex:1,display:"flex",position:"relative",overflow:"hidden"}}>
        <div style={{flex:1,overflowY:"auto",padding:"12px 14px",display:"flex",flexDirection:"column",gap:10}}>
          {messages.map((m,i)=>(
            <div key={i} style={{animation:"fadeIn 0.25s ease"}}>
              <div style={{display:"flex",justifyContent:m.role==="user"?"flex-end":"flex-start"}}>
                {m.role==="assistant"&&<div style={{width:22,height:22,borderRadius:"50%",background:"rgba(200,168,75,0.15)",border:"0.5px solid rgba(200,168,75,0.3)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,color:"#C8A84B",fontWeight:700,flexShrink:0,marginRight:7,marginTop:2}}>J</div>}
                <div style={{maxWidth:"80%",padding:"8px 12px",borderRadius:m.role==="user"?"12px 12px 2px 12px":"12px 12px 12px 2px",background:m.role==="user"?"rgba(200,168,75,0.1)":"rgba(255,255,255,0.04)",border:m.role==="user"?"0.5px solid rgba(200,168,75,0.2)":"0.5px solid rgba(255,255,255,0.07)",fontSize:13,lineHeight:1.65,color:m.role==="user"?"#E8DFC8":"#D4CEBE"}}>
                  {typeof m.content==="string"?fmt(m.content):m.content}
                </div>
              </div>
              {m.emailDrafts?.map((e,j)=><div key={j} style={{marginLeft:30}}><EmailCard {...e}/></div>)}
              {m.ghlActions?.map((g,j)=><div key={j} style={{marginLeft:30}}><GHLCard {...g}/></div>)}
            </div>
          ))}
          {activeTools.length>0&&<div style={{display:"flex",flexDirection:"column",gap:4,marginLeft:30}}>{activeTools.map((t,i)=><ToolBadge key={i} {...t}/>)}</div>}
          {loading&&!activeTools.length&&(
            <div style={{display:"flex",alignItems:"flex-start",gap:7}}>
              <div style={{width:22,height:22,borderRadius:"50%",background:"rgba(200,168,75,0.15)",border:"0.5px solid rgba(200,168,75,0.3)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,color:"#C8A84B",fontWeight:700,flexShrink:0}}>J</div>
              <TypingDots/>
            </div>
          )}
          <div ref={bottomRef}/>
        </div>
        {panel==="memory"&&<div style={{animation:"slideIn 0.2s ease"}}><MemoryPanel memories={memories} onDelete={deleteMemory} onClose={()=>setPanel(null)}/></div>}
      </div>

      <div style={{padding:"8px 12px",borderTop:"0.5px solid rgba(255,255,255,0.07)",flexShrink:0}}>
        <div style={{display:"flex",gap:8,alignItems:"flex-end",background:"rgba(255,255,255,0.04)",border:"0.5px solid rgba(255,255,255,0.1)",borderRadius:12,padding:"7px 8px 7px 12px"}}>
          <textarea value={input} onChange={e=>setInput(e.target.value)} onKeyDown={handleKey}
            placeholder="Command J.A.R.V.I.S. — email, GHL, strategy, ClosingPilot..."
            rows={1}
            style={{flex:1,background:"transparent",border:"none",color:"#E8E3D9",fontSize:13,lineHeight:1.6,maxHeight:90,overflowY:"auto",caretColor:"#C8A84B"}}
            onInput={e=>{e.target.style.height="auto";e.target.style.height=Math.min(e.target.scrollHeight,90)+"px";}}
          />
          <button className="send-btn" onClick={()=>sendMessage()} disabled={loading||!input.trim()}
            style={{width:30,height:30,borderRadius:"50%",background:input.trim()&&!loading?"#C8A84B":"rgba(255,255,255,0.05)",border:"none",cursor:input.trim()&&!loading?"pointer":"default",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,transition:"all 0.15s"}}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
              <path d="M22 2L11 13" stroke={input.trim()&&!loading?"#0D0D0F":"#555"} strokeWidth="2" strokeLinecap="round"/>
              <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke={input.trim()&&!loading?"#0D0D0F":"#555"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
        <p style={{fontSize:9,color:"#2a2a2a",textAlign:"center",marginTop:5,letterSpacing:"0.04em",fontFamily:"'DM Mono',monospace"}}>JARVIS · EMAIL · GHL · MEMORY ACTIVE</p>
      </div>
    </div>
  );
}
