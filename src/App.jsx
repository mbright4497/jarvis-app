import { useState, useRef, useEffect } from "react";

const GHL_WEBHOOK = "https://services.leadconnectorhq.com/hooks/D1dTmgY5G8SuVs91hoBJ/webhook-trigger/0e2f8ae2-2470-43d5-ab40-c86a8c17d2df";
const ANTHROPIC_KEY = import.meta.env.VITE_ANTHROPIC_KEY;
const MODEL = "claude-sonnet-4-6";

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
- Required: first_name, last_name, email, subject, greeting, body. If email address is missing, ask once. Then call the tool.
- greeting MUST be exactly: Hi [first_name], with their real first name (plain text). body = main message only (2–3 sentences); no greeting, no sign-off — GHL adds the signature.
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
        greeting:   { type: "string", description: "Exactly: Hi Firstname, (comma at end). Nothing else." },
        body:       { type: "string", description: "Main message only, 2–3 sentences; no greeting or sign-off (GHL adds signature)." }
      },
      required: ["first_name", "last_name", "email", "subject", "greeting", "body"]
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
  { id: "email",        label: "Send Email",   icon: "✉", prompt: "Help me send an email. Ask me who it's to and what I need to say." },
  { id: "ghl",          label: "Add to GHL",   icon: "⚡", prompt: "I want to add a contact to GoHighLevel. Ask me for their details." },
  { id: "strategy",     label: "Strategy",     icon: "♟", prompt: "Let's work through a strategic decision. Ask me what I'm weighing." },
  { id: "closingpilot", label: "ClosingPilot", icon: "🏠", prompt: "Let's work on ClosingPilot. Ask me what I need — product, feature, code, or workflow." },
  { id: "revenue",      label: "Revenue",      icon: "💰", prompt: "Let's analyze revenue or financials. Ask me what to focus on." },
  { id: "sop",          label: "Build SOP",    icon: "📋", prompt: "Help me build a Standard Operating Procedure. Ask me what process we're documenting." },
];

// ── Agent Switcher ─────────────────────────────────────────────────────────────
const AGENT_PROMPTS = {
  CFO:  `ACTIVE MODE: CFO — Focus exclusively on revenue, MRR/ARR, runway, pricing strategy, Stripe data, and financial decisions across ClosingPilot, HubLinkPro, MOAT, Open Claw. Surface risks. Protect runway. Push toward $1M ARR by Q1 2027. Every answer ends with a financial implication.`,
  CMO:  `ACTIVE MODE: CMO — Focus on Facebook ads, HubLinkPro campaigns, positioning, hooks, copy, funnels, and GTM strategy. Think in conversion, not impressions. Every answer moves Matthew closer to his next paying customer.`,
  CTO:  `ACTIVE MODE: CTO — Focus on JARVIS upgrades, Closing Jet builds, MOAT development, Claude AI implementation, and stack decisions. Write clean production code. Explain the WHY behind every technical decision. Only build what ships.`,
  MOAT: `ACTIVE MODE: MOAT — Focus on identifying dying apps with trapped paying users, scoring replacement opportunities, global market sizing, and AI-native build planning. Target: 3 MOAT apps per quarter, multi-language, 4B addressable market.`,
  OPS:  `ACTIVE MODE: OPS — Focus on SOPs, daily briefings, client onboarding, task prioritization, and running four companies solo. Help Matthew operate like a team of 10. Systemize everything. Cut what doesn't matter.`,
};

const AGENTS = [
  { id: "CFO",  emoji: "💰", label: "CFO"  },
  { id: "CMO",  emoji: "📣", label: "CMO"  },
  { id: "CTO",  emoji: "🔧", label: "CTO"  },
  { id: "MOAT", emoji: "💀", label: "MOAT" },
  { id: "OPS",  emoji: "⚙️", label: "OPS"  },
];

const IDEA_CATEGORIES = ["App / SaaS", "Automation", "Agency", "Real Estate", "AI Tool", "Other"];
const EMPTY_FORM = { name: "", description: "", category: "App / SaaS" };

const storage = {
  get: (key) => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
  set: (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} },
};

const callClaude = (body) => fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
  body: JSON.stringify(body)
}).then(r => r.json());

// ── Typing dots ──────────────────────────────────────────────────────────────
const TypingDots = () => (
  <div style={{ display:"flex", alignItems:"center", gap:5, padding:"10px 14px", background:"rgba(255,255,255,0.04)", borderRadius:12, width:"fit-content", border:"0.5px solid rgba(255,255,255,0.08)" }}>
    {[0,1,2].map(i => <div key={i} style={{ width:7, height:7, borderRadius:"50%", background:"#C8A84B", animation:"pulse 1.2s ease-in-out infinite", animationDelay:`${i*0.2}s` }}/>)}
  </div>
);

// ── Tool badge ────────────────────────────────────────────────────────────────
const ToolBadge = ({ name, status }) => {
  const map = { send_email:["#534AB7","#EEEDFE","✉ Preparing email"], trigger_ghl:["#993C1D","#FAECE7","⚡ Triggering GHL"] };
  const [fg, bg, label] = map[name] || ["#5F5E5A","#F1EFE8", name];
  return (
    <div style={{ display:"inline-flex", alignItems:"center", gap:6, padding:"4px 10px", background:bg, borderRadius:20, fontSize:11, color:fg, fontWeight:500, margin:"4px 0", border:`0.5px solid ${fg}33` }}>
      {label} {status === "running" ? "..." : "✓"}
    </div>
  );
};

const htmlToPlain = (s) => (s || "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").trim();

// ── Email card ────────────────────────────────────────────────────────────────
const EmailCard = ({ first_name, last_name, email, phone, subject, body, greeting, missing_email }) => {
  const [ghlStatus, setGhlStatus] = useState("ready");
  const [copied, setCopied]       = useState(false);
  const displayName = [first_name, last_name].filter(Boolean).join(" ");
  const g = greeting ?? "";
  const b = body ?? "";

  const fireGHL = async () => {
    setGhlStatus("sending");
    try {
      const payload = { first_name, last_name, email, subject, greeting: g, body: b };
      if (phone) payload.phone = phone;
      const res = await fetch(GHL_WEBHOOK, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(payload) });
      const data = await res.json();
      setGhlStatus(data.success !== false ? "sent" : "error");
    } catch { setGhlStatus("error"); }
  };

  const copyPayload = () => {
    const o = { first_name, last_name, email, subject, greeting: g, body: b, missing_email: !!missing_email };
    navigator.clipboard.writeText(JSON.stringify(o, null, 2));
    setCopied(true); setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div style={{ background:"rgba(83,74,183,0.08)", border:"0.5px solid rgba(83,74,183,0.3)", borderRadius:10, padding:"12px 14px", marginTop:8 }}>
      <div style={{ fontSize:10, color:"#7F77DD", letterSpacing:"0.08em", fontWeight:600, marginBottom:8 }}>EMAIL → GHL</div>
      <div style={{ fontSize:12, color:"#999", marginBottom:2 }}>To: <span style={{ color:"#D4CEBE" }}>{displayName} {email ? `<${email}>` : ""}</span></div>
      <div style={{ fontSize:12, color:"#999", marginBottom:8 }}>Subject: <span style={{ color:"#D4CEBE", fontWeight:500 }}>{subject}</span></div>
      <div style={{ fontSize:12, color:"#C0BAB0", lineHeight:1.7, borderTop:"0.5px solid rgba(255,255,255,0.06)", paddingTop:8 }}>
        {g ? <div style={{ marginBottom:8 }}>{g}</div> : null}
        {b ? <div style={{ whiteSpace:"pre-wrap" }}>{b}</div> : null}
        {!g && !b && body ? <div style={{ whiteSpace:"pre-wrap" }}>{body}</div> : null}
      </div>
      <div style={{ display:"flex", gap:8, marginTop:10, flexWrap:"wrap" }}>
        <button onClick={fireGHL} disabled={ghlStatus==="sending"||ghlStatus==="sent"}
          style={{ padding:"6px 12px", background:ghlStatus==="sent"?"rgba(74,222,128,0.15)":"rgba(200,168,75,0.15)", border:`0.5px solid ${ghlStatus==="sent"?"rgba(74,222,128,0.4)":"rgba(200,168,75,0.35)"}`, borderRadius:8, color:ghlStatus==="sent"?"#4ADE80":"#C8A84B", fontSize:11, cursor:"pointer" }}>
          {ghlStatus==="sent" ? "✓ Sent via GHL" : ghlStatus==="sending" ? "Firing..." : ghlStatus==="error" ? "✕ Failed — retry" : "⚡ Fire to GHL"}
        </button>
        <a href={`mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent([htmlToPlain(g), htmlToPlain(b)].filter(Boolean).join("\n\n") || htmlToPlain(body))}`}
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

// ── GHL card ──────────────────────────────────────────────────────────────────
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

// ── Memory panel ──────────────────────────────────────────────────────────────
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

// ── Score helpers ─────────────────────────────────────────────────────────────
const scoreColor = (s) => s >= 80 ? "#4ADE80" : s >= 60 ? "#C8A84B" : "#F0997B";
const rankLabel  = (s) => s >= 80 ? "BUILD NOW" : s >= 60 ? "STRONG" : s >= 40 ? "POSSIBLE" : "PARK IT";

// ── Idea Vault ────────────────────────────────────────────────────────────────
const IdeaVault = ({ memories }) => {
  const [ideas,    setIdeas]    = useState([]);
  const [form,     setForm]     = useState(EMPTY_FORM);
  const [scoring,  setScoring]  = useState(false);
  const [subView,  setSubView]  = useState("list"); // list | add | detail
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    const saved = storage.get("jarvis_ideas") || [];
    setIdeas(saved);
  }, []);

  const persist = (updated) => { setIdeas(updated); storage.set("jarvis_ideas", updated); };

  const scoreIdea = async (name, description, category) => {
    const memCtx = memories.length
      ? `\nMatt's context: ${memories.map(m=>`${m.key}: ${m.value}`).join(", ")}`
      : "";
    const prompt = `You are JARVIS scoring a business idea for Matt Bright — solo founder CEO of ClosingPilot (real estate SaaS), HubLinkPro (AI agency), MOAT (app intelligence), Open Claw (AI automation). Goal: $1M ARR by Q1 2027, 3 apps/quarter, 4B global users.${memCtx}

Score this idea. Return ONLY valid JSON, no markdown:
{"revenue_potential":<0-100>,"speed_to_market":<0-100>,"ease_of_sale":<0-100>,"stack_leverage":<0-100>,"overall":<revenue*0.35+speed*0.25+ease*0.20+stack*0.20, round to 1 decimal>,"verdict":"<punchy 10-word max verdict>","best_move":"<exactly what Matt should do with this idea right now, 1 sentence>"}

Idea: "${name}" — ${description} (Category: ${category})`;

    const data = await callClaude({ model:MODEL, max_tokens:500, messages:[{ role:"user", content:prompt }] });
    const raw = data.content?.map(b=>b.text||"").join("").replace(/```json|```/g,"").trim();
    return JSON.parse(raw);
  };

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.description.trim()) return;
    setScoring(true);
    try {
      const scores = await scoreIdea(form.name, form.description, form.category);
      const idea = { id: Date.now(), ...form, scores, createdAt: new Date().toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}) };
      const updated = [idea, ...ideas].sort((a,b) => b.scores.overall - a.scores.overall);
      persist(updated);
      setForm(EMPTY_FORM);
      setSubView("list");
    } catch(e) { alert("Scoring failed — check API key."); }
    setScoring(false);
  };

  const deleteIdea = (id) => { persist(ideas.filter(i=>i.id!==id)); setSelected(null); setSubView("list"); };

  const top = ideas[0];

  // ── List view ──
  if (subView === "list") return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", overflow:"hidden" }}>
      {top && (
        <div onClick={()=>{ setSelected(top); setSubView("detail"); }}
          style={{ padding:"10px 14px", background:"rgba(74,222,128,0.05)", borderBottom:"0.5px solid rgba(74,222,128,0.15)", display:"flex", alignItems:"center", gap:12, cursor:"pointer" }}>
          <div style={{ fontSize:9, color:"#4ADE80", letterSpacing:"0.12em", fontWeight:600, whiteSpace:"nowrap", fontFamily:"'DM Mono',monospace" }}>TOP PRIORITY</div>
          <div style={{ fontSize:12, color:"#E8E3D9", flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{top.name}</div>
          <div style={{ fontSize:12, color:"#4ADE80", fontWeight:600, fontFamily:"'DM Mono',monospace" }}>{Math.round(top.scores.overall)}</div>
        </div>
      )}
      <div style={{ flex:1, overflowY:"auto", padding:"8px 0" }}>
        {ideas.length === 0 && (
          <div style={{ textAlign:"center", padding:"50px 20px", color:"#333" }}>
            <div style={{ fontSize:28, marginBottom:10, opacity:0.4 }}>◈</div>
            <div style={{ fontSize:11, letterSpacing:"0.1em", marginBottom:6, fontFamily:"'DM Mono',monospace" }}>VAULT EMPTY</div>
            <div style={{ fontSize:11, color:"#2a2a2a" }}>Log your first idea — JARVIS scores it automatically</div>
          </div>
        )}
        {ideas.map((idea, i) => (
          <div key={idea.id} onClick={()=>{ setSelected(idea); setSubView("detail"); }}
            style={{ padding:"11px 14px", borderBottom:"0.5px solid rgba(255,255,255,0.04)", display:"flex", alignItems:"center", gap:12, cursor:"pointer", transition:"background 0.15s" }}
            onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.03)"}
            onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
            <div style={{ fontSize:10, color:"#2a2a2a", minWidth:18, fontFamily:"'DM Mono',monospace" }}>#{i+1}</div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:13, color:"#E8E3D9", marginBottom:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{idea.name}</div>
              <div style={{ fontSize:10, color:"#444", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", fontStyle:"italic" }}>{idea.scores.verdict}</div>
            </div>
            <div style={{ textAlign:"right", minWidth:72 }}>
              <div style={{ fontSize:13, fontWeight:600, color:scoreColor(idea.scores.overall), fontFamily:"'DM Mono',monospace" }}>{Math.round(idea.scores.overall)}</div>
              <div style={{ fontSize:8, letterSpacing:"0.1em", color:scoreColor(idea.scores.overall), opacity:0.7, fontFamily:"'DM Mono',monospace" }}>{rankLabel(idea.scores.overall)}</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ padding:"10px 14px", borderTop:"0.5px solid rgba(255,255,255,0.07)" }}>
        <button onClick={()=>setSubView("add")}
          style={{ width:"100%", padding:"8px", background:"rgba(200,168,75,0.1)", border:"0.5px solid rgba(200,168,75,0.3)", borderRadius:8, color:"#C8A84B", fontSize:12, cursor:"pointer", fontFamily:"'DM Mono',monospace", letterSpacing:"0.06em", transition:"all 0.15s" }}
          onMouseEnter={e=>{ e.currentTarget.style.background="rgba(200,168,75,0.18)"; }}
          onMouseLeave={e=>{ e.currentTarget.style.background="rgba(200,168,75,0.1)"; }}>
          + LOG IDEA
        </button>
      </div>
    </div>
  );

  // ── Add view ──
  if (subView === "add") return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", overflow:"hidden" }}>
      <div style={{ padding:"10px 14px", borderBottom:"0.5px solid rgba(255,255,255,0.07)", display:"flex", alignItems:"center", gap:10 }}>
        <button onClick={()=>setSubView("list")} style={{ background:"none", border:"none", color:"#555", cursor:"pointer", fontSize:16, lineHeight:1 }}>←</button>
        <div style={{ fontSize:11, color:"#C8A84B", letterSpacing:"0.1em", fontFamily:"'DM Mono',monospace" }}>NEW IDEA</div>
      </div>
      <div style={{ flex:1, overflowY:"auto", padding:"16px 14px", display:"flex", flexDirection:"column", gap:14 }}>
        <div>
          <div style={{ fontSize:9, color:"#555", letterSpacing:"0.1em", marginBottom:6, fontFamily:"'DM Mono',monospace" }}>IDEA NAME</div>
          <input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="e.g. Bot2Bot"
            style={{ width:"100%", background:"rgba(255,255,255,0.04)", border:"0.5px solid rgba(255,255,255,0.1)", borderRadius:8, padding:"9px 12px", color:"#E8E3D9", fontSize:13, fontFamily:"'DM Sans',sans-serif", outline:"none" }}
            onFocus={e=>e.target.style.borderColor="rgba(200,168,75,0.5)"}
            onBlur={e=>e.target.style.borderColor="rgba(255,255,255,0.1)"} />
        </div>
        <div>
          <div style={{ fontSize:9, color:"#555", letterSpacing:"0.1em", marginBottom:6, fontFamily:"'DM Mono',monospace" }}>WHAT IS IT</div>
          <textarea value={form.description} onChange={e=>setForm({...form,description:e.target.value})}
            placeholder="One or two sentences. What does it do, who buys it?"
            rows={3}
            style={{ width:"100%", background:"rgba(255,255,255,0.04)", border:"0.5px solid rgba(255,255,255,0.1)", borderRadius:8, padding:"9px 12px", color:"#E8E3D9", fontSize:13, fontFamily:"'DM Sans',sans-serif", outline:"none", resize:"vertical" }}
            onFocus={e=>e.target.style.borderColor="rgba(200,168,75,0.5)"}
            onBlur={e=>e.target.style.borderColor="rgba(255,255,255,0.1)"} />
        </div>
        <div>
          <div style={{ fontSize:9, color:"#555", letterSpacing:"0.1em", marginBottom:6, fontFamily:"'DM Mono',monospace" }}>CATEGORY</div>
          <select value={form.category} onChange={e=>setForm({...form,category:e.target.value})}
            style={{ width:"100%", background:"rgba(255,255,255,0.04)", border:"0.5px solid rgba(255,255,255,0.1)", borderRadius:8, padding:"9px 12px", color:"#E8E3D9", fontSize:13, fontFamily:"'DM Sans',sans-serif", outline:"none" }}>
            {IDEA_CATEGORIES.map(c=><option key={c} style={{background:"#1a1a1e"}}>{c}</option>)}
          </select>
        </div>
        <div style={{ fontSize:10, color:"#333", fontStyle:"italic" }}>JARVIS scores this against revenue potential, speed to market, ease of sale, and stack leverage — then ranks it against everything else in your vault.</div>
      </div>
      <div style={{ padding:"10px 14px", borderTop:"0.5px solid rgba(255,255,255,0.07)" }}>
        <button onClick={handleSubmit} disabled={scoring||!form.name.trim()||!form.description.trim()}
          style={{ width:"100%", padding:"9px", background:scoring||!form.name.trim()||!form.description.trim()?"rgba(255,255,255,0.04)":"rgba(200,168,75,0.15)", border:`0.5px solid ${scoring||!form.name.trim()||!form.description.trim()?"rgba(255,255,255,0.08)":"rgba(200,168,75,0.4)"}`, borderRadius:8, color:scoring||!form.name.trim()||!form.description.trim()?"#333":"#C8A84B", fontSize:12, cursor:scoring||!form.name.trim()||!form.description.trim()?"not-allowed":"pointer", fontFamily:"'DM Mono',monospace", letterSpacing:"0.06em", transition:"all 0.15s" }}>
          {scoring ? "JARVIS SCORING..." : "SCORE & SAVE →"}
        </button>
      </div>
    </div>
  );

  // ── Detail view ──
  if (subView === "detail" && selected) return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", overflow:"hidden" }}>
      <div style={{ padding:"10px 14px", borderBottom:"0.5px solid rgba(255,255,255,0.07)", display:"flex", alignItems:"center", gap:10 }}>
        <button onClick={()=>{ setSelected(null); setSubView("list"); }} style={{ background:"none", border:"none", color:"#555", cursor:"pointer", fontSize:16, lineHeight:1 }}>←</button>
        <div style={{ fontSize:10, color:"#555", fontFamily:"'DM Mono',monospace", letterSpacing:"0.08em" }}>{selected.category}</div>
        <div style={{ marginLeft:"auto", fontSize:9, color:"#333", fontFamily:"'DM Mono',monospace" }}>{selected.createdAt}</div>
      </div>
      <div style={{ flex:1, overflowY:"auto", padding:"16px 14px" }}>
        <div style={{ fontSize:16, fontWeight:600, color:"#E8E3D9", marginBottom:6, lineHeight:1.3 }}>{selected.name}</div>
        <div style={{ fontSize:12, color:"#555", marginBottom:20, lineHeight:1.6 }}>{selected.description}</div>

        {/* Overall */}
        <div style={{ background:"rgba(255,255,255,0.03)", border:"0.5px solid rgba(255,255,255,0.07)", borderRadius:10, padding:"14px", marginBottom:16 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end", marginBottom:10 }}>
            <div>
              <div style={{ fontSize:9, color:"#555", letterSpacing:"0.1em", fontFamily:"'DM Mono',monospace", marginBottom:4 }}>OVERALL</div>
              <div style={{ fontSize:32, fontWeight:600, color:scoreColor(selected.scores.overall), fontFamily:"'DM Mono',monospace", lineHeight:1 }}>{Math.round(selected.scores.overall)}</div>
            </div>
            <div style={{ fontSize:10, color:scoreColor(selected.scores.overall), fontFamily:"'DM Mono',monospace", letterSpacing:"0.1em", fontWeight:600 }}>{rankLabel(selected.scores.overall)}</div>
          </div>
          <div style={{ fontSize:11, color:"#666", fontStyle:"italic", borderTop:"0.5px solid rgba(255,255,255,0.06)", paddingTop:10 }}>"{selected.scores.verdict}"</div>
        </div>

        {/* Scores */}
        {[
          { label:"Revenue potential", key:"revenue_potential", w:"35%" },
          { label:"Speed to market",   key:"speed_to_market",   w:"25%" },
          { label:"Ease of sale",      key:"ease_of_sale",      w:"20%" },
          { label:"Stack leverage",    key:"stack_leverage",    w:"20%" },
        ].map(({ label, key, w }) => (
          <div key={key} style={{ marginBottom:12 }}>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
              <span style={{ fontSize:11, color:"#666" }}>{label}</span>
              <div style={{ display:"flex", gap:10, alignItems:"center" }}>
                <span style={{ fontSize:9, color:"#2a2a2a", fontFamily:"'DM Mono',monospace" }}>{w}</span>
                <span style={{ fontSize:11, color:scoreColor(selected.scores[key]), fontWeight:600, minWidth:24, textAlign:"right", fontFamily:"'DM Mono',monospace" }}>{selected.scores[key]}</span>
              </div>
            </div>
            <div style={{ background:"rgba(255,255,255,0.05)", height:3, borderRadius:2 }}>
              <div style={{ width:`${selected.scores[key]}%`, height:3, background:scoreColor(selected.scores[key]), borderRadius:2, transition:"width 0.5s ease" }}/>
            </div>
          </div>
        ))}

        {/* Recommendation */}
        <div style={{ background:"rgba(200,168,75,0.06)", border:"0.5px solid rgba(200,168,75,0.2)", borderRadius:8, padding:"12px 14px", marginTop:16 }}>
          <div style={{ fontSize:9, color:"#C8A84B", letterSpacing:"0.1em", fontFamily:"'DM Mono',monospace", marginBottom:6 }}>JARVIS SAYS</div>
          <div style={{ fontSize:12, color:"#B0A990", lineHeight:1.6 }}>{selected.scores.best_move}</div>
        </div>
      </div>
      <div style={{ padding:"10px 14px", borderTop:"0.5px solid rgba(255,255,255,0.07)" }}>
        <button onClick={()=>deleteIdea(selected.id)}
          style={{ width:"100%", padding:"7px", background:"rgba(240,153,123,0.06)", border:"0.5px solid rgba(240,153,123,0.2)", borderRadius:8, color:"#F0997B", fontSize:11, cursor:"pointer", fontFamily:"'DM Mono',monospace", letterSpacing:"0.06em" }}>
          DELETE IDEA
        </button>
      </div>
    </div>
  );

  return null;
};

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [messages,     setMessages]     = useState([]);
  const [input,        setInput]        = useState("");
  const [loading,      setLoading]      = useState(false);
  const [memories,     setMemories]     = useState([]);
  const [panel,        setPanel]        = useState(null);
  const [savingMemory, setSavingMemory] = useState(false);
  const [activeTools,  setActiveTools]  = useState([]);
  const [activeTab,    setActiveTab]    = useState("chat"); // "chat" | "ideas"
  const [activeAgent,  setActiveAgent]  = useState(null);
  const [isListening,  setIsListening]  = useState(false);
  const [isSpeaking,   setIsSpeaking]   = useState(false);
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
    const agentBlock = activeAgent && AGENT_PROMPTS[activeAgent]
      ? `\n\n${AGENT_PROMPTS[activeAgent]}`
      : "";
    const base = `${BASE_SYSTEM_PROMPT}${agentBlock}`;
    if (!memories.length) return base;
    const block = memories.map(m=>`[${m.category.toUpperCase()}] ${m.key}: ${m.value}`).join("\n");
    return `${base}\n\n--- MATTHEW'S MEMORY ---\n${block}\n--- END MEMORY ---`;
  };

  const extractFacts = async (msg) => {
    try {
      const data = await callClaude({ model:MODEL, max_tokens:400,
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
      const data = await callClaude({ model:MODEL, max_tokens:600,
        messages:[{ role:"user", content:
          `You are an email composer for Matthew Bright, CEO of ClosingPilot.${ctx}
CRITICAL — GHL adds the sender signature automatically. Do NOT put any sign-off, closing, or signature in greeting or body. No "Best regards", no "Sincerely", no sender name, no title, no company name.
Extract fields and return ONLY valid JSON — no other text:
{"first_name":"","last_name":"","email":"","subject":"","greeting":"Hi [first_name],","body":"[main message 2-3 sentences]","missing_email":false}
If no email address provided, set missing_email:true.
Request: "${userText}"` }] });
      const raw = data.content?.map(b=>b.text||"").join("").replace(/```json|```/g,"").trim();
      const parsed = JSON.parse(raw);
      parsed.body = parsed.body.replace(/best regards[\s\S]*/gi, '').trim();
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
      setMessages(prev => [...prev, { role:"assistant", content:"" }]);
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_KEY,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: MODEL, max_tokens: 1000, stream: true,
          system: buildSystemPrompt(),
          tools: TOOLS, tool_choice: { type:"auto" },
          messages: apiMessages,
        }),
      });
      if (!res.ok) throw new Error(`API ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let blocks = {};
      let stopReason = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream:true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const ev = JSON.parse(line.slice(6).trim());
            if (ev.type === "content_block_start") {
              const cb = ev.content_block;
              blocks[ev.index] = cb.type === "tool_use"
                ? { type:"tool_use", id:cb.id, name:cb.name, inputStr:"" }
                : { type:"text", text:"" };
              if (cb.type === "tool_use") setActiveTools(prev => [...prev, { name:cb.name, status:"running" }]);
            }
            if (ev.type === "content_block_delta") {
              const b = blocks[ev.index];
              if (!b) continue;
              if (ev.delta.type === "text_delta") {
                b.text += ev.delta.text;
                const snap = b.text;
                setMessages(prev => { const u=[...prev]; u[u.length-1]={ role:"assistant", content:snap }; return u; });
              }
              if (ev.delta.type === "input_json_delta") b.inputStr += ev.delta.partial_json;
            }
            if (ev.type === "message_delta") stopReason = ev.delta.stop_reason;
          } catch {}
        }
      }
      if (stopReason === "tool_use") {
        const toolBlocks = Object.values(blocks).filter(b => b?.type === "tool_use");
        const emailDrafts = []; const ghlActions = [];
        const parsedTools = toolBlocks.map(b => {
          let input = {};
          try { input = JSON.parse(b.inputStr || "{}"); } catch {}
          if (b.name === "send_email")  emailDrafts.push(input);
          if (b.name === "trigger_ghl") ghlActions.push(input);
          return { ...b, input };
        });
        const toolResults = parsedTools.map(b => ({
          type:"tool_result", tool_use_id:b.id, content:JSON.stringify({ success:true })
        }));
        const assistantContent = Object.values(blocks).filter(Boolean).map(b =>
          b.type === "text"
            ? { type:"text", text: b.text || "." }
            : { type:"tool_use", id:b.id, name:b.name, input: parsedTools.find(p=>p.id===b.id)?.input || {} }
        );
        setMessages(prev => { const u=[...prev]; u[u.length-1]={ role:"assistant", content:"" }; return u; });
        const res2 = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": ANTHROPIC_KEY,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true",
          },
          body: JSON.stringify({
            model: MODEL, max_tokens: 1000, stream: true,
            system: buildSystemPrompt(),
            tools: TOOLS, tool_choice: { type:"auto" },
            messages: [...apiMessages, { role:"assistant", content:assistantContent }, { role:"user", content:toolResults }],
          }),
        });
        if (!res2.ok) throw new Error(`API ${res2.status}`);
        const reader2 = res2.body.getReader();
        let buf2 = ""; let finalText = "";
        while (true) {
          const { done, value } = await reader2.read();
          if (done) break;
          buf2 += dec.decode(value, { stream:true });
          const lines = buf2.split("\n");
          buf2 = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const ev = JSON.parse(line.slice(6).trim());
              if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
                finalText += ev.delta.text;
                setMessages(prev => { const u=[...prev]; u[u.length-1]={ role:"assistant", content:finalText, emailDrafts, ghlActions }; return u; });
              }
            } catch {}
          }
        }
      }
    } catch(e) {
      setMessages(prev => { const u=[...prev]; u[u.length-1]={ role:"assistant", content:`Error: ${e.message}` }; return u; });
    }
    // Speak the final assistant response
    setMessages(prev => {
      const last = prev[prev.length - 1];
      if (last?.role === "assistant" && last?.content) {
        speakText(last.content.slice(0, 500));
      }
      return prev;
    });
    setActiveTools([]); setLoading(false);
  };

  const handleKey = (e) => { if (e.key==="Enter"&&!e.shiftKey){ e.preventDefault(); sendMessage(); }};

  const speakText = async (text) => {
    const key = import.meta.env.VITE_ELEVEN_KEY;
    const stripMarkdown = (t) => t
      .replace(/\|[\s\S]*?\|/g, "")
      .replace(/\*\*?(.*?)\*\*?/g, "$1")
      .replace(/#{1,6}\s/g, "")
      .replace(/`{1,3}[^`]*`{1,3}/g, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[-*]\s/g, "")
      .replace(/\n{2,}/g, ". ")
      .replace(/\n/g, " ")
      .trim();
    const cleanText = stripMarkdown(text);
    if (!key || !cleanText) return;
    const DANIEL = "onwK4e9ZLuTAKqWW03F9";
    try {
      setIsSpeaking(true);
      const res = await fetch("https://api.elevenlabs.io/v1/text-to-speech/" + DANIEL, {
        method: "POST",
        headers: { "xi-api-key": key, "Content-Type": "application/json", "Accept": "audio/mpeg" },
        body: JSON.stringify({ text: cleanText, model_id: "eleven_turbo_v2", voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
      });
      if (!res.ok) { setIsSpeaking(false); return; }
      const buffer = await res.arrayBuffer();
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const decoded = await ctx.decodeAudioData(buffer);
      const source = ctx.createBufferSource();
      source.buffer = decoded;
      source.connect(ctx.destination);
      source.onended = () => { setIsSpeaking(false); ctx.close(); };
      source.start(0);
    } catch { setIsSpeaking(false); }
  };

  // ── Voice input — Web Speech API ──────────────────────────────────────────
  // No API key needed. Browser handles transcription locally.
  // onresult fires when speech is detected → sets input → user can edit or send.
  // onend always fires (even on error) → resets listening state.
  const startListening = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert("Voice input not supported in this browser. Use Chrome."); return; }
    if (isListening) return;
    const recognition = new SR();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart  = () => setIsListening(true);
    recognition.onend    = () => setIsListening(false);
    recognition.onerror  = () => setIsListening(false);
    recognition.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      setInput(transcript);
    };
    recognition.start();
  };

  const fmt = (text) => text.split("\n").map((line,i)=>{
    if (line.startsWith("**")&&line.endsWith("**")) return <p key={i} style={{margin:"8px 0 4px",fontWeight:600,color:"#C8A84B",fontSize:12,letterSpacing:"0.04em",textTransform:"uppercase"}}>{line.replace(/\*\*/g,"")}</p>;
    if (line.match(/^\d+\.\s/)) return <p key={i} style={{margin:"3px 0",paddingLeft:4}}>{line}</p>;
    if (line.startsWith("- ")||line.startsWith("• ")) return <p key={i} style={{margin:"3px 0",paddingLeft:12,borderLeft:"2px solid rgba(200,168,75,0.3)"}}>{line.replace(/^[-•]\s/,"")}</p>;
    if (line==="") return <div key={i} style={{height:6}}/>;
    return <p key={i} style={{margin:"2px 0"}}>{line}</p>;
  });

  const ideaCount = (storage.get("jarvis_ideas") || []).length;

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
        .tab-btn:hover{color:#E8E3D9!important}
      `}</style>

      {/* ── Header ── */}
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

      {/* ── Tab switcher ── */}
      <div style={{display:"flex",borderBottom:"0.5px solid rgba(255,255,255,0.07)",flexShrink:0}}>
        {[
          { id:"chat",  label:"CHAT" },
          { id:"ideas", label:`IDEAS${ideaCount > 0 ? ` (${ideaCount})` : ""}` },
        ].map(tab => (
          <button key={tab.id} className="tab-btn" onClick={()=>{ setActiveTab(tab.id); setPanel(null); }}
            style={{ flex:1, padding:"9px 0", background:"transparent", border:"none", borderBottom:activeTab===tab.id?"1.5px solid #C8A84B":"1.5px solid transparent", color:activeTab===tab.id?"#C8A84B":"#444", fontSize:10, cursor:"pointer", letterSpacing:"0.12em", fontFamily:"'DM Mono',monospace", transition:"all 0.15s", marginBottom:-1 }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Chat quick actions (only on chat tab) ── */}
      {activeTab === "chat" && (
        <div style={{padding:"7px 12px",borderBottom:"0.5px solid rgba(255,255,255,0.05)",display:"flex",gap:5,overflowX:"auto",flexShrink:0}}>
          {QUICK_ACTIONS.map(a=>(
            <button key={a.id} className="qbtn" onClick={()=>sendMessage(a.prompt)}
              style={{padding:"4px 10px",background:"rgba(255,255,255,0.03)",border:"0.5px solid rgba(255,255,255,0.08)",borderRadius:20,color:"#888",fontSize:11,cursor:"pointer",whiteSpace:"nowrap",transition:"all 0.15s",fontFamily:"inherit"}}>
              {a.icon} {a.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Agent Switcher ── */}
      {activeTab === "chat" && (
        <div style={{padding:"5px 12px",borderBottom:"0.5px solid rgba(255,255,255,0.04)",display:"flex",gap:5,alignItems:"center",flexShrink:0,overflowX:"auto"}}>
          <span style={{fontSize:9,color:"#555",fontFamily:"'DM Mono',monospace",flexShrink:0,marginRight:4,letterSpacing:"0.06em"}}>MODE</span>
          {AGENTS.map(agent => {
            const on = activeAgent === agent.id;
            return (
              <button key={agent.id}
                onClick={() => setActiveAgent(on ? null : agent.id)}
                style={{
                  padding:"4px 12px",
                  background: on ? "rgba(200,168,75,0.18)" : "rgba(255,255,255,0.06)",
                  border: on ? "0.5px solid rgba(200,168,75,0.7)" : "0.5px solid rgba(255,255,255,0.15)",
                  borderRadius:20, color: on ? "#C8A84B" : "#aaa",
                  fontSize:11, cursor:"pointer", whiteSpace:"nowrap",
                  fontFamily:"'DM Mono',monospace", letterSpacing:"0.05em",
                  transition:"all 0.15s", display:"flex", alignItems:"center", gap:5,
                }}>
                {agent.emoji} {agent.label}
              </button>
            );
          })}
          {activeAgent && (
            <span style={{fontSize:9,color:"#C8A84B",fontFamily:"'DM Mono',monospace",marginLeft:4,letterSpacing:"0.06em",flexShrink:0,fontWeight:600}}>
              {activeAgent} ACTIVE
            </span>
          )}
        </div>
      )}

      {/* ── Body ── */}
      <div style={{flex:1,display:"flex",position:"relative",overflow:"hidden"}}>

        {/* Chat view */}
        {activeTab === "chat" && (
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
        )}

        {/* Ideas view */}
        {activeTab === "ideas" && (
          <div style={{flex:1,overflow:"hidden",display:"flex",flexDirection:"column"}}>
            <IdeaVault memories={memories}/>
          </div>
        )}

        {panel==="memory"&&activeTab==="chat"&&<div style={{animation:"slideIn 0.2s ease"}}><MemoryPanel memories={memories} onDelete={deleteMemory} onClose={()=>setPanel(null)}/></div>}
      </div>

      {/* ── Input (chat only) ── */}
      {activeTab === "chat" && (
        <div style={{padding:"8px 12px",borderTop:"0.5px solid rgba(255,255,255,0.07)",flexShrink:0}}>
          <div style={{display:"flex",gap:8,alignItems:"flex-end",background:"rgba(255,255,255,0.04)",border:"0.5px solid rgba(255,255,255,0.1)",borderRadius:12,padding:"7px 8px 7px 12px"}}>
            <textarea value={input} onChange={e=>setInput(e.target.value)} onKeyDown={handleKey}
              placeholder="Command J.A.R.V.I.S. — email, GHL, strategy, ClosingPilot..."
              rows={1}
              style={{flex:1,background:"transparent",border:"none",color:"#E8E3D9",fontSize:13,lineHeight:1.6,maxHeight:90,overflowY:"auto",caretColor:"#C8A84B"}}
              onInput={e=>{e.target.style.height="auto";e.target.style.height=Math.min(e.target.scrollHeight,90)+"px";}}
            />
            <button onClick={startListening} disabled={isListening || loading}
              style={{width:30,height:30,borderRadius:"50%",background:isListening?"rgba(200,168,75,0.2)":"rgba(255,255,255,0.05)",border:isListening?"0.5px solid rgba(200,168,75,0.6)":"0.5px solid rgba(255,255,255,0.1)",cursor:isListening?"default":"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,transition:"all 0.15s"}}>
              {isListening
                ? <div style={{width:8,height:8,borderRadius:"50%",background:"#C8A84B",animation:"pulse 1.2s ease-in-out infinite"}}/>
                : <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><rect x="9" y="2" width="6" height="12" rx="3" stroke="#888" strokeWidth="2"/><path d="M5 10a7 7 0 0014 0" stroke="#888" strokeWidth="2" strokeLinecap="round"/><line x1="12" y1="19" x2="12" y2="22" stroke="#888" strokeWidth="2" strokeLinecap="round"/></svg>
              }
            </button>
            <button className="send-btn" onClick={()=>sendMessage()} disabled={loading||!input.trim()}
              style={{width:30,height:30,borderRadius:"50%",background:input.trim()&&!loading?"#C8A84B":"rgba(255,255,255,0.05)",border:"none",cursor:input.trim()&&!loading?"pointer":"default",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,transition:"all 0.15s"}}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                <path d="M22 2L11 13" stroke={input.trim()&&!loading?"#0D0D0F":"#555"} strokeWidth="2" strokeLinecap="round"/>
                <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke={input.trim()&&!loading?"#0D0D0F":"#555"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
          <p style={{fontSize:9,color:"#2a2a2a",textAlign:"center",marginTop:5,letterSpacing:"0.04em",fontFamily:"'DM Mono',monospace"}}>JARVIS · EMAIL · GHL · MEMORY · IDEAS ACTIVE</p>
        </div>
      )}
    </div>
  );
}
