"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type SignalType = "confirmed" | "rumor" | "event";
type Panel = "menu" | "activity" | "watch" | "messages" | "report" | "help" | null;
type MapMode = "global" | "thermal" | "web";
type Sighting = {
  id: number;
  city: string;
  country: string;
  report: string;
  time: string;
  confidence: number;
  type: SignalType;
  x: number;
  y: number;
};

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const label: Record<SignalType, string> = {
  confirmed: "CONFIRMADO",
  rumor: "RUMOR",
  event: "EVENTO",
};

const initialSightings: Sighting[] = [
  { id: 1042, city: "NUEVA YORK", country: "ESTADOS UNIDOS", report: "Movimiento vertical entre edificios", time: "AHORA", confidence: 97, type: "confirmed", x: 27, y: 34 },
  { id: 1038, city: "CIUDAD DE MÉXICO", country: "MÉXICO", report: "Figura roja observada en una azotea", time: "04 MIN", confidence: 72, type: "rumor", x: 21, y: 51 },
  { id: 1024, city: "MADRID", country: "ESPAÑA", report: "Encuentro de la red internacional", time: "18 MIN", confidence: 91, type: "event", x: 47, y: 39 },
  { id: 1019, city: "LONDRES", country: "REINO UNIDO", report: "Trayectoria aérea no identificada", time: "26 MIN", confidence: 88, type: "confirmed", x: 48, y: 31 },
  { id: 1007, city: "RIAD", country: "ARABIA SAUDITA", report: "Señal proyectada sobre torre central", time: "41 MIN", confidence: 66, type: "rumor", x: 61, y: 50 },
  { id: 996, city: "SEÚL", country: "COREA DEL SUR", report: "Rastro de telaraña sintética", time: "01 H", confidence: 95, type: "confirmed", x: 85, y: 39 },
  { id: 981, city: "MANILA", country: "FILIPINAS", report: "Interferencia en transporte urbano", time: "02 H", confidence: 83, type: "event", x: 84, y: 55 },
  { id: 970, city: "SÃO PAULO", country: "BRASIL", report: "Alerta ciudadana cerca del centro", time: "03 H", confidence: 74, type: "confirmed", x: 36, y: 70 },
  { id: 954, city: "SÍDNEY", country: "AUSTRALIA", report: "Objeto oscilante a gran velocidad", time: "04 H", confidence: 57, type: "rumor", x: 89, y: 78 },
];

const scanPool = [
  ["TOKIO", "JAPÓN", 89, 42],
  ["EL CAIRO", "EGIPTO", 55, 48],
  ["BOGOTÁ", "COLOMBIA", 29, 61],
  ["PARÍS", "FRANCIA", 49, 36],
  ["DUBÁI", "EMIRATOS ÁRABES", 63, 50],
  ["JOHANNESBURGO", "SUDÁFRICA", 55, 75],
] as const;

const threats = [
  { name: "SCORPION", code: "VX-01", level: "CRÍTICO", note: "Blindaje pesado y una cola mecánica capaz de perforar concreto. Su firma energética aparece cerca del distrito financiero.", color: "#75dfac" },
  { name: "BOOMERANG", code: "VX-02", level: "ALTO", note: "Especialista en proyectiles de retorno. Cambia de trayectoria sin previo aviso y suele crear señuelos electrónicos.", color: "#f5bf55" },
  { name: "TARÁNTULA", code: "VX-03", level: "ALTO", note: "Combatiente acrobático con toxina de contacto. El tracker recomienda mantener una distancia mínima de veinte metros.", color: "#ef4d57" },
  { name: "DESCONOCIDO", code: "VX-??", level: "SIN DATOS", note: "Patrón todavía sin identificar. La red ha encontrado conexiones con seis incidentes recientes en Nueva York.", color: "#9edcff" },
];

const missions = [
  { tag: "01 / RASTREAR", title: "Ecos sobre Queens", text: "Tres pulsos cruzaron el East River. Encuentra la señal con mayor confianza antes de que se apague.", reward: "+250 XP" },
  { tag: "02 / ANALIZAR", title: "Telaraña fantasma", text: "Una fibra sintética apareció en cuatro ciudades al mismo tiempo. Separa el rumor del avistamiento real.", reward: "+400 XP" },
  { tag: "03 / RESPONDER", title: "Alerta roja", text: "El sistema detectó una amenaza de nivel crítico. Activa el barrido mundial y fija sus coordenadas.", reward: "+600 XP" },
];

const sprite = [
  ".....KKKKKK.....",
  "...KKRRRRRRKK...",
  "..KRRRRRRRRRRK..",
  "..KRRWWRRWWRRK..",
  "..KRRWWRRWWRRK..",
  "..KRRRRKKRRRRK..",
  "...KRRRRRRRRK...",
  "....KKRRRRKK....",
  "......KRRK......",
  "..RRRRKRRKRRRR..",
  ".RRRRRKRRKRRRRR.",
  "RRR..KRRRRK..RRR",
  "RR...KRWWRK...RR",
  ".....KRRRRK.....",
  ".....KBBBBK.....",
  "....KKBBBBKK....",
  "...KBBBBBBBBK...",
  "...KBBBKKBBBK...",
  "...KBBK..KBBK...",
  "...KBBK..KBBK...",
  "..KBBK....KBBK..",
  "..KBBK....KBBK..",
  "..KRRK....KRRK..",
  ".KRRRK....KRRRK.",
  ".KKKKK....KKKKK.",
];

const pad = (n: number) => String(n).padStart(2, "0");
const coordinates = (item: Sighting) => ({
  lat: `${Math.abs(90 - item.y * 1.8).toFixed(4)}° ${90 - item.y * 1.8 >= 0 ? "N" : "S"}`,
  lng: `${Math.abs(item.x * 3.6 - 180).toFixed(4)}° ${item.x * 3.6 - 180 >= 0 ? "E" : "W"}`,
});

function PixelSpidey({ labelText, pose = "idle" }: { labelText?: string; pose?: "idle" | "swing" | "crouch" | "hang" }) {
  return (
    <div className={`pixel-spidey-v2 pose-${pose}`} role={labelText ? "img" : undefined} aria-label={labelText} aria-hidden={labelText ? undefined : true}>
      <div className="pixel-webline" />
      <div className="pixel-sprite" style={{ "--sprite-rows": sprite.length } as React.CSSProperties}>
        {sprite.flatMap((row, y) => row.split("").map((color, x) => color === "." ? null : <i className={`pixel pixel-${color}`} style={{ gridColumn: x + 1, gridRow: y + 1 }} key={`${x}-${y}`} />))}
      </div>
      <span className="pixel-sense"><i /><i /><i /></span>
    </div>
  );
}

export default function Home() {
  const [trackerReady, setTrackerReady] = useState(false);
  const [sound, setSound] = useState(false);
  const [clock, setClock] = useState("--:--:--");
  const [sightings, setSightings] = useState(initialSightings);
  const [selectedId, setSelectedId] = useState(1042);
  const [filters, setFilters] = useState<Record<SignalType, boolean>>({ confirmed: true, rumor: true, event: true });
  const [panel, setPanel] = useState<Panel>(null);
  const [scanning, setScanning] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [mapMode, setMapMode] = useState<MapMode>("global");
  const [ticker, setTicker] = useState("RED GLOBAL ACTIVA // ESPERANDO NUEVOS AVISTAMIENTOS");
  const [messageRead, setMessageRead] = useState(false);
  const [suit, setSuit] = useState<"classic" | "stealth">("classic");
  const [siteMenu, setSiteMenu] = useState(false);
  const [activeMission, setActiveMission] = useState(0);
  const [activeThreat, setActiveThreat] = useState(0);
  const [reportCity, setReportCity] = useState("");
  const [reportText, setReportText] = useState("");

  const visible = useMemo(() => sightings.filter((s) => filters[s.type]), [sightings, filters]);
  const selected = sightings.find((s) => s.id === selectedId) ?? sightings[0];
  const coords = coordinates(selected);

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setClock(`${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`);
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const beep = useCallback((frequency = 520, duration = 0.07) => {
    if (!sound) return;
    try {
      const AudioEngine = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioEngine) return;
      const context = new AudioEngine();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "square";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.035, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + duration);
    } catch { /* El audio es opcional. */ }
  }, [sound]);

  const runScan = useCallback(() => {
    if (scanning) return;
    setScanning(true);
    setTicker("BARRIDO GLOBAL EN CURSO // ANALIZANDO 12,408 FRECUENCIAS...");
    beep(260, 0.12);
    window.setTimeout(() => {
      const point = scanPool[Math.floor(Math.random() * scanPool.length)];
      const type: SignalType = Math.random() > 0.65 ? "confirmed" : "rumor";
      const item: Sighting = {
        id: Date.now(), city: point[0], country: point[1], x: point[2], y: point[3], type,
        report: "Nueva señal captada por la red internacional", time: "AHORA", confidence: 68 + Math.floor(Math.random() * 30),
      };
      setSightings((current) => [item, ...current]);
      setSelectedId(item.id);
      setFilters((current) => ({ ...current, [type]: true }));
      setTicker(`¡NUEVO AVISTAMIENTO! // ${item.city}, ${item.country}`);
      setScanning(false);
      beep(860, 0.16);
    }, 2400);
  }, [beep, scanning]);

  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setPanel(null); setSiteMenu(false); }
      if (event.key.toLowerCase() === "s" && trackerReady) runScan();
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, [runScan, trackerReady]);

  const goTracker = () => document.getElementById("tracker")?.scrollIntoView({ behavior: "smooth" });
  const select = (item: Sighting) => {
    setSelectedId(item.id);
    setTicker(`OBJETIVO FIJADO // ${item.city} // CONFIANZA ${item.confidence}%`);
    beep(item.type === "confirmed" ? 720 : 440);
  };
  const toggleFilter = (type: SignalType) => { setFilters((current) => ({ ...current, [type]: !current[type] })); beep(380); };
  const nudge = (x: number, y: number) => setPan((current) => ({ x: Math.max(-110, Math.min(110, current.x + x)), y: Math.max(-70, Math.min(70, current.y + y)) }));
  const resetMap = () => { setPan({ x: 0, y: 0 }); setZoom(1); beep(600); };
  const activateTracker = (withSound: boolean) => { setSound(withSound); setTrackerReady(true); setTicker("SPIDEY TRACKER v6.0 // TODOS LOS SISTEMAS EN LÍNEA"); };
  const submitReport = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const city = reportCity.trim().toUpperCase();
    if (!city) return;
    const item: Sighting = { id: Date.now(), city, country: "REPORTE DE LA RED", report: reportText.trim() || "Avistamiento ciudadano pendiente de verificación", time: "AHORA", confidence: 62, type: "rumor", x: 18 + Math.random() * 68, y: 25 + Math.random() * 48 };
    setSightings((current) => [item, ...current]);
    setSelectedId(item.id);
    setFilters((current) => ({ ...current, rumor: true }));
    setReportCity(""); setReportText(""); setPanel(null);
    setTicker(`REPORTE RECIBIDO // ${city} // VALIDACIÓN PENDIENTE`);
    beep(780, 0.12);
  };

  return (
    <main className={`spidey-site suit-${suit}`}>
      <header className="site-nav">
        <a className="site-brand" href="#inicio"><span>SPIDEY</span><i>✣</i><span>NETWORK</span></a>
        <nav className={siteMenu ? "open" : ""} aria-label="Navegación principal">
          <a href="#historia" onClick={() => setSiteMenu(false)}>LA RED</a>
          <a href="#misiones" onClick={() => setSiteMenu(false)}>MISIONES</a>
          <a href="#amenazas" onClick={() => setSiteMenu(false)}>AMENAZAS</a>
          <a href="#tracker" onClick={() => setSiteMenu(false)}>TRACKER</a>
        </nav>
        <div className="nav-actions">
          <button className="suit-toggle" onClick={() => setSuit((value) => value === "classic" ? "stealth" : "classic")}><span>INTERFAZ</span>{suit === "classic" ? "CLÁSICA" : "SIGILO"}</button>
          <button className="mobile-menu" onClick={() => setSiteMenu((value) => !value)} aria-expanded={siteMenu} aria-label="Abrir menú">☰</button>
        </div>
      </header>

      <section className="command-hero" id="inicio" style={{ "--hero-image": `url("${basePath}/hero-command.png")` } as React.CSSProperties} onPointerMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        event.currentTarget.style.setProperty("--mx", `${((event.clientX - rect.left) / rect.width - 0.5) * 2}`);
        event.currentTarget.style.setProperty("--my", `${((event.clientY - rect.top) / rect.height - 0.5) * 2}`);
      }}>
        <img className="command-cover" src={`${basePath}/hero-command.png`} alt="Spidey Network: centro de mando nocturno con radares y mapa global" />
        <div className="command-shade" /><div className="command-scan" /><div className="command-noise" />
        <div className="command-beacons" aria-hidden="true"><i /><i /><i /><i /></div>
        <div className="command-agent"><PixelSpidey pose="swing" labelText="Héroe arácnido pixel-art patrullando la red" /><span>HÉROE EN PATRULLA // LINK ACTIVO</span></div>
        <h1 className="sr-only">Spidey Network — La ciudad está en línea</h1>
        <div className="command-console">
          <p><span /> SISTEMA SMT-06 // CONEXIÓN SEGURA</p>
          <div className="command-actions">
            <button className="primary-action" onClick={goTracker}>INICIAR RASTREO <span>↗</span></button>
            <a href="#historia">EXPLORAR EXPERIENCIA ↓</a>
          </div>
        </div>
        <div className="command-telemetry"><b>12,408</b><span>SENSORES ACTIVOS</span><i /><b>98.7%</b><span>PRECISIÓN DE RED</span></div>
        <div className="scroll-cue"><span />DESLIZA PARA PATRULLAR</div>
      </section>

      <section className="story-section" id="historia">
        <div className="story-lead"><p className="section-code">01 // LA RED</p><h2>UNA CIUDAD.<br />MILES DE OJOS.</h2><p>La ciudad nunca duerme y la red tampoco. Cada cámara, mensaje y sensor puede ser la pieza que falta para encontrar la próxima señal.</p></div>
        <div className="network-panels">
          <article><span>01</span><i className="panel-icon">◎</i><h3>RASTREO GLOBAL</h3><p>Señales distribuidas sobre un mapa mundial con coordenadas, confianza y procedencia.</p></article>
          <article><span>02</span><i className="panel-icon">⌁</i><h3>SPIDER-SENSE</h3><p>Un barrido dinámico separa patrones reales, rumores y eventos de la red.</p></article>
          <article><span>03</span><i className="panel-icon">▦</i><h3>ARCHIVO VIVO</h3><p>Misiones, amenazas, reportes ciudadanos y actividad reunidos en una sola consola.</p></article>
        </div>
      </section>

      <section className="mission-section" id="misiones">
        <div className="mission-heading"><div><p className="section-code">02 // SIMULADOR DE CAMPO</p><h2>ELIGE TU<br /><em>PRÓXIMA MISIÓN.</em></h2></div><PixelSpidey pose="crouch" labelText="Héroe arácnido pixel-art agazapado" /></div>
        <div className="mission-console">
          <div className="mission-tabs" role="tablist">{missions.map((mission, index) => <button key={mission.tag} role="tab" aria-selected={activeMission === index} onClick={() => setActiveMission(index)}><span>{mission.tag}</span><b>{mission.title}</b></button>)}</div>
          <article className="mission-detail"><span className="mission-status">MISIÓN DISPONIBLE</span><b className="mission-index">0{activeMission + 1}</b><h3>{missions[activeMission].title}</h3><p>{missions[activeMission].text}</p><div><span>RECOMPENSA DE RED</span><b>{missions[activeMission].reward}</b></div><button onClick={() => { goTracker(); setTicker(`MISIÓN ACTIVA // ${missions[activeMission].title.toUpperCase()}`); }}>ACEPTAR MISIÓN <span>→</span></button></article>
          <div className="mission-radar" aria-hidden="true"><i /><i /><i /><span>✣</span></div>
        </div>
      </section>

      <section className="threat-section" id="amenazas">
        <div className="threat-heading"><div><p className="section-code">03 // VIGILANCIA WEB</p><h2>ARCHIVOS DE<br />AMENAZAS.</h2></div><div className="threat-nav"><button onClick={() => setActiveThreat((value) => value === 0 ? threats.length - 1 : value - 1)} aria-label="Amenaza anterior">←</button><span>{pad(activeThreat + 1)} / {pad(threats.length)}</span><button onClick={() => setActiveThreat((value) => (value + 1) % threats.length)} aria-label="Amenaza siguiente">→</button></div></div>
        <div className="threat-dossier"><div className="threat-portrait" style={{ "--threat": threats[activeThreat].color } as React.CSSProperties}><span>{threats[activeThreat].code}</span><div className="portrait-rings"><i /><i /><b>◉</b></div></div><article><span>NIVEL // {threats[activeThreat].level}</span><h3>{threats[activeThreat].name}</h3><p>{threats[activeThreat].note}</p><dl><div><dt>ÚLTIMA SEÑAL</dt><dd>HACE 12 MIN</dd></div><div><dt>ZONA</dt><dd>MANHATTAN</dd></div><div><dt>ESTADO</dt><dd>EN MOVIMIENTO</dd></div></dl><button onClick={() => { goTracker(); setPanel("watch"); }}>ABRIR EXPEDIENTE ↗</button></article></div>
      </section>

      <section className="tracker-section" id="tracker">
        <div className="tracker-intro"><div><p className="section-code">04 // SISTEMA SMT-06</p><h2>SPIDEY<br /><em>TRACKER.</em></h2></div><p>Filtra avistamientos, cambia la capa del mapa, reporta señales, abre expedientes y ejecuta barridos. Atajo: presiona <kbd>S</kbd> para escanear.</p></div>
        <div className={`tracker-app tracker-v6 ${trackerReady ? "is-online" : "is-locked"}`}>
          {!trackerReady && <div className="tracker-boot"><div className="boot-web" /><div className="boot-hanger"><PixelSpidey pose="hang" /></div><div className="boot-terminal" aria-hidden="true"><span>CALIBRANDO MOTOR DE SPRITES [OK]</span><span>VALIDANDO FUENTES DE SEÑAL [OK]</span><span>SINCRONIZANDO MAPA GLOBAL [OK]</span><span>ENCRIPTANDO CANAL DE RED [OK]</span></div><div className="boot-copy"><span>SPIDEY TRACKER v6.0</span><h3>LA RED ESTÁ PREPARADA.</h3><p>Elige una configuración para iniciar el centro de mando.</p><div><button onClick={() => activateTracker(true)}>◖)) INICIAR CON SONIDO</button><button onClick={() => activateTracker(false)}>INICIAR EN SILENCIO</button></div></div></div>}
          <div className="tracker-hardware"><div className="corner-bolt bolt-a" /><div className="corner-bolt bolt-b" /><div className="corner-bolt bolt-c" /><div className="corner-bolt bolt-d" />
            <header className="tracker-head"><button className="nav-trigger" onClick={() => setPanel(panel === "menu" ? null : "menu")} aria-label="Abrir navegación"><span /><span /><span /></button><div className="tracker-logo"><span>SPIDEY</span><i>◉</i><span>TRACKER</span><small>SMT-06</small></div><button className="spider-chip" onClick={runScan} aria-label="Iniciar barrido global">✣</button></header>
            <aside className="left-rail">
              <button onClick={() => setPanel("activity")} className={panel === "activity" ? "active" : ""}><b>LOG</b><span>REGISTRO</span></button>
              <button onClick={() => setPanel("watch")} className={panel === "watch" ? "active" : ""}><b>WEB</b><span>VIGILANCIA</span></button>
              <button onClick={() => { setPanel("messages"); setMessageRead(true); }} className={panel === "messages" ? "active" : ""}><b>MSG</b><span>MENSAJES</span>{!messageRead && <i />}</button>
              <button onClick={() => setPanel("report")} className={panel === "report" ? "active" : ""}><b>RPT</b><span>REPORTAR</span></button>
            </aside>
            <section className="map-viewport" aria-label="Mapa mundial de avistamientos">
              <div className="crt-lines" /><div className="map-coordinates"><span>OBJETIVO ACTUAL</span>{coords.lat} / {coords.lng}</div>
              <div className="map-mode-switch" aria-label="Capas del mapa">{(["global", "thermal", "web"] as MapMode[]).map((mode) => <button key={mode} aria-pressed={mapMode === mode} onClick={() => setMapMode(mode)}>{mode === "global" ? "GLOBAL" : mode === "thermal" ? "TÉRMICO" : "RED"}</button>)}</div>
              <div className={`map-stage mode-${mapMode}`} style={{ transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})` }} onWheel={(event) => { event.preventDefault(); setZoom((value) => Math.max(1, Math.min(1.9, value + (event.deltaY < 0 ? 0.1 : -0.1)))); }}>
                <img className="world-map" src={`${basePath}/world-map.png`} alt="Mapa político del mundo" /><div className="map-grid" /><div className="map-web-network" />
                {visible.map((item) => <button key={item.id} className={`world-marker ${item.type} ${selectedId === item.id ? "selected" : ""}`} style={{ left: `${item.x}%`, top: `${item.y}%` }} onClick={() => select(item)} aria-label={`${label[item.type]} en ${item.city}`}><span>✣</span><i /><em>{item.city}</em></button>)}
                <div className={`swinging-spidey ${scanning ? "scanning" : ""}`}><PixelSpidey pose="swing" /></div>
              </div>
              <div className={`radar-sweep ${scanning ? "active" : ""}`} /><div className="map-vignette" />
              {scanning && <div className="scan-progress" role="status"><span>ANALIZANDO FRECUENCIAS</span><b>RASTREO GLOBAL EN CURSO</b><i><em /></i></div>}
              <div className="filter-panel"><span>FILTROS</span>{(["confirmed", "rumor", "event"] as SignalType[]).map((type) => <button key={type} className={type} aria-pressed={filters[type]} onClick={() => toggleFilter(type)}><i>✣</i>{label[type]}</button>)}</div>
              <div className="map-controls"><button onClick={() => nudge(0, 35)} aria-label="Arriba">▲</button><button onClick={() => nudge(35, 0)} aria-label="Izquierda">◀</button><button onClick={resetMap} aria-label="Centrar">◎</button><button onClick={() => nudge(-35, 0)} aria-label="Derecha">▶</button><button onClick={() => nudge(0, -35)} aria-label="Abajo">▼</button><button onClick={() => setZoom((value) => value >= 1.9 ? 1 : value + 0.3)} aria-label="Zoom">{zoom.toFixed(1)}×</button></div>
              <article className="sighting-card"><div className={`sighting-type ${selected.type}`}>{label[selected.type]}</div><p>SEÑAL #{String(selected.id).slice(-4)} // {selected.time}</p><h2>{selected.city}</h2><h3>{selected.country}</h3><div className="confidence"><span>CONFIANZA</span><b>{selected.confidence}%</b><i><em style={{ width: `${selected.confidence}%` }} /></i></div><div className="signal-metrics"><span>ALT <b>184 M</b></span><span>VEL <b>72 KM/H</b></span><span>LINK <b>SEGURO</b></span></div><p className="report">“{selected.report}.”</p><button className="track-button" onClick={runScan} disabled={scanning}>{scanning ? "RASTREANDO..." : "RASTREAR SEÑAL"}</button></article>
              <div className="mobile-signal-strip" aria-label="Señales disponibles">{visible.slice(0, 6).map((item) => <button key={item.id} aria-pressed={selectedId === item.id} onClick={() => select(item)}><i className={item.type} />{item.city}</button>)}</div>
            </section>
            <div className="ticker-bar" aria-live="polite"><div className="ticker-content"><span>●</span>{ticker}<i>///</i>{ticker}<i>///</i></div></div>
            <button className="sound-button" onClick={() => setSound((value) => !value)} aria-pressed={sound}>{sound ? "◖))" : "◖×"}<span>SONIDO</span></button>
            <div className="mascot-dock"><PixelSpidey labelText="Héroe arácnido pixel-art" /><span className="spider-sense">!</span></div>
          </div>
        </div>
      </section>

      <div className={`side-drawer ${panel ? "open" : ""}`} aria-hidden={!panel}>
        <button className="drawer-close" onClick={() => setPanel(null)}>CERRAR ×</button>
        {panel === "menu" && <><p className="drawer-kicker">NAVEGACIÓN</p><h2>RED SPIDEY</h2><nav><button onClick={() => setPanel("activity")}>01 / REGISTRO</button><button onClick={() => setPanel("watch")}>02 / VIGILANCIA WEB</button><button onClick={() => setPanel("messages")}>03 / MENSAJES</button><button onClick={() => setPanel("report")}>04 / REPORTAR SEÑAL</button><button onClick={() => setPanel("help")}>05 / AYUDA</button><button onClick={runScan}>06 / NUEVO BARRIDO</button></nav></>}
        {panel === "activity" && <><p className="drawer-kicker">DATOS EN TIEMPO REAL</p><h2>REGISTRO DE ACTIVIDAD</h2><div className="activity-list">{sightings.slice(0, 8).map((item) => <button key={item.id} onClick={() => { select(item); setPanel(null); }}><i className={item.type}>✣</i><span><b>{item.city}</b><small>{item.report}</small></span><time>{item.time}</time></button>)}</div></>}
        {panel === "watch" && <><p className="drawer-kicker">ARCHIVO CONFIDENCIAL</p><h2>VIGILANCIA WEB 2.0</h2><div className="villain-grid">{threats.map((item) => <article key={item.code}><span>{item.code}</span><div className="villain-face">◉</div><h3>{item.name}</h3><p>{item.note}</p></article>)}</div></>}
        {panel === "messages" && <><p className="drawer-kicker">CANAL CIFRADO</p><h2>CENTRO DE MENSAJES</h2><div className="message-card"><span>MENSAJE ENTRANTE // 00:01</span><h3>HEY, OPERADOR.</h3><p>La red detectó actividad fuera de Queens. Usa la vista global, filtra los rumores y confirma la señal más fuerte.</p><b>— N. L.</b></div></>}
        {panel === "report" && <><p className="drawer-kicker">CANAL CIUDADANO</p><h2>REPORTAR AVISTAMIENTO</h2><form className="report-form" onSubmit={submitReport}><label>CIUDAD<input value={reportCity} onChange={(event) => setReportCity(event.target.value)} placeholder="Ej. Tegucigalpa" maxLength={40} required /></label><label>DESCRIPCIÓN<textarea value={reportText} onChange={(event) => setReportText(event.target.value)} placeholder="¿Qué viste?" maxLength={180} /></label><p>El reporte se marcará como rumor hasta que la red lo confirme.</p><button type="submit">ENVIAR A LA RED →</button></form></>}
        {panel === "help" && <><p className="drawer-kicker">MANUAL SMT-06</p><h2>GUÍA DE OPERACIÓN</h2><div className="help-grid"><article><b>01</b><h3>EXPLORA</h3><p>Usa los controles, la rueda o los botones para cambiar la escala del mapa.</p></article><article><b>02</b><h3>FILTRA</h3><p>Activa y desactiva avistamientos confirmados, rumores y eventos.</p></article><article><b>03</b><h3>ESCANEA</h3><p>Presiona S o el emblema superior para buscar una señal nueva.</p></article></div></>}
      </div>

      <footer className="site-footer"><div className="site-brand"><span>SPIDEY</span><i>✣</i><span>NETWORK</span></div><p>Experiencia fan interactiva no oficial. Todos los avistamientos son ficticios.</p><div><a href="#inicio">VOLVER ARRIBA ↑</a><span>{clock} // LINK 98%</span></div></footer>
    </main>
  );
}
