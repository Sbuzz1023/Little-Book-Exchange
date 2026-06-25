export default function KidDrawingBackground() {
  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none"
      viewBox="0 0 1400 560"
      preserveAspectRatio="xMidYMid slice"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Sun top-left */}
      <g opacity="0.22" transform="translate(60,30)">
        <circle cx="50" cy="50" r="35" fill="#fbbf24"/>
        {[0,45,90,135,180,225,270,315].map((deg, i) => {
          const r = (deg * Math.PI) / 180
          return <line key={i} x1={50+35*Math.sin(r)} y1={50-35*Math.cos(r)} x2={50+48*Math.sin(r)} y2={50-48*Math.cos(r)} stroke="#fbbf24" strokeWidth="5" strokeLinecap="round"/>
        })}
        <circle cx="50" cy="50" r="28" fill="#fde68a"/>
        <circle cx="40" cy="44" r="4" fill="#f97316"/>
        <circle cx="60" cy="44" r="4" fill="#f97316"/>
        <path d="M40 58 Q50 68 60 58" stroke="#f97316" strokeWidth="3" fill="none" strokeLinecap="round"/>
      </g>

      {/* Stick figure family */}
      <g opacity="0.18" transform="translate(170,210)">
        <circle cx="30" cy="14" r="12" fill="none" stroke="#f97316" strokeWidth="3"/>
        <circle cx="26" cy="12" r="2" fill="#f97316"/><circle cx="34" cy="12" r="2" fill="#f97316"/>
        <path d="M26 18 Q30 22 34 18" stroke="#f97316" strokeWidth="2" fill="none" strokeLinecap="round"/>
        <line x1="30" y1="26" x2="30" y2="65" stroke="#f97316" strokeWidth="3.5" strokeLinecap="round"/>
        <line x1="30" y1="38" x2="5" y2="55" stroke="#f97316" strokeWidth="3" strokeLinecap="round"/>
        <line x1="30" y1="38" x2="65" y2="42" stroke="#f97316" strokeWidth="3" strokeLinecap="round"/>
        <line x1="30" y1="65" x2="15" y2="95" stroke="#f97316" strokeWidth="3.5" strokeLinecap="round"/>
        <line x1="30" y1="65" x2="45" y2="95" stroke="#f97316" strokeWidth="3.5" strokeLinecap="round"/>
        <rect x="18" y="2" width="24" height="8" fill="#f97316" rx="3"/>
        <circle cx="80" cy="18" r="11" fill="none" stroke="#0d9488" strokeWidth="3"/>
        <circle cx="76" cy="16" r="2" fill="#0d9488"/><circle cx="84" cy="16" r="2" fill="#0d9488"/>
        <path d="M76 22 Q80 26 84 22" stroke="#0d9488" strokeWidth="2" fill="none" strokeLinecap="round"/>
        <path d="M80 29 L60 90 L100 90 Z" fill="none" stroke="#0d9488" strokeWidth="3" strokeLinejoin="round"/>
        <line x1="80" y1="42" x2="55" y2="55" stroke="#0d9488" strokeWidth="2.5" strokeLinecap="round"/>
        <line x1="80" y1="42" x2="105" y2="50" stroke="#0d9488" strokeWidth="2.5" strokeLinecap="round"/>
        <circle cx="52" cy="42" r="9" fill="none" stroke="#fbbf24" strokeWidth="2.5"/>
        <circle cx="49" cy="40" r="1.5" fill="#fbbf24"/><circle cx="55" cy="40" r="1.5" fill="#fbbf24"/>
        <path d="M49 46 Q52 49 55 46" stroke="#fbbf24" strokeWidth="2" fill="none" strokeLinecap="round"/>
        <line x1="52" y1="51" x2="52" y2="75" stroke="#fbbf24" strokeWidth="2.5" strokeLinecap="round"/>
        <line x1="52" y1="58" x2="40" y2="68" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round"/>
        <line x1="52" y1="58" x2="64" y2="65" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round"/>
        <line x1="52" y1="75" x2="44" y2="92" stroke="#fbbf24" strokeWidth="2.5" strokeLinecap="round"/>
        <line x1="52" y1="75" x2="60" y2="92" stroke="#fbbf24" strokeWidth="2.5" strokeLinecap="round"/>
      </g>

      {/* House left */}
      <g opacity="0.2" transform="translate(30,190)">
        <polygon points="10,60 70,10 130,60" fill="#f97316"/>
        <rect x="85" y="15" width="16" height="28" fill="#fca5a5" rx="3"/>
        <circle cx="93" cy="8" r="6" fill="#e5e7eb"/>
        <rect x="20" y="58" width="100" height="70" fill="#fff7ed" stroke="#f97316" strokeWidth="3" rx="4"/>
        <rect x="55" y="90" width="30" height="38" fill="#0d9488" rx="4"/>
        <circle cx="80" cy="110" r="3" fill="#fbbf24"/>
        <rect x="28" y="70" width="22" height="20" fill="#bfdbfe" rx="3" stroke="#3b82f6" strokeWidth="2"/>
        <rect x="90" y="70" width="22" height="20" fill="#bfdbfe" rx="3" stroke="#3b82f6" strokeWidth="2"/>
        <path d="M0,128 Q70,118 140,128" stroke="#16a34a" strokeWidth="4" fill="none" strokeLinecap="round"/>
      </g>

      {/* Rainbow center-top */}
      <g opacity="0.18" transform="translate(340,20)">
        {['#f97316','#fbbf24','#4ade80','#3b82f6','#a78bfa'].map((color, i) => (
          <path key={i} d={`M${10+i*10} 90 Q80 ${10+i*12} ${150-i*10} 90`} stroke={color} strokeWidth={9-i} fill="none" strokeLinecap="round"/>
        ))}
        <ellipse cx="10" cy="90" rx="16" ry="10" fill="#e5e7eb"/>
        <ellipse cx="150" cy="90" rx="16" ry="10" fill="#e5e7eb"/>
      </g>

      {/* Flowers bottom-left */}
      <g opacity="0.2" transform="translate(30,400)">
        {[20, 55, 90].map((x, i) => {
          const colors = ['#fca5a5','#a5f3fc','#fde68a']
          const centers = ['#fbbf24','#f97316','#0d9488']
          return (
            <g key={x}>
              <line x1={x} y1="80" x2={x} y2="42" stroke="#16a34a" strokeWidth="4" strokeLinecap="round"/>
              <circle cx={x} cy="30" r="12" fill={colors[i]}/>
              {[0,90,180,270].map((deg, j) => {
                const r = (deg * Math.PI) / 180
                return <circle key={j} cx={x+12*Math.sin(r)} cy={30-12*Math.cos(r)} r="6" fill={colors[i]}/>
              })}
              <circle cx={x} cy="30" r="7" fill={centers[i]}/>
            </g>
          )
        })}
        <path d="M0,80 Q60,68 120,80" stroke="#16a34a" strokeWidth="4" fill="none" strokeLinecap="round"/>
      </g>

      {/* House right */}
      <g opacity="0.18" transform="translate(1200,200)">
        <polygon points="10,55 75,5 140,55" fill="#0d9488"/>
        <rect x="85" y="8" width="14" height="30" fill="#fca5a5" rx="2"/>
        <rect x="20" y="53" width="110" height="75" fill="#fffbf0" stroke="#0d9488" strokeWidth="3" rx="3"/>
        <rect x="55" y="88" width="28" height="40" fill="#f97316" rx="4"/>
        <rect x="26" y="64" width="22" height="20" fill="#bfdbfe" rx="3" stroke="#3b82f6" strokeWidth="2"/>
        <rect x="95" y="64" width="22" height="20" fill="#bfdbfe" rx="3" stroke="#3b82f6" strokeWidth="2"/>
        <path d="M0,128 Q75,118 148,128" stroke="#16a34a" strokeWidth="4" fill="none" strokeLinecap="round"/>
      </g>

      {/* Cat bottom-right */}
      <g opacity="0.18" transform="translate(1290,380)">
        <ellipse cx="45" cy="65" rx="38" ry="30" fill="#a78bfa"/>
        <circle cx="45" cy="28" r="24" fill="#a78bfa"/>
        <polygon points="24,12 18,0 34,8" fill="#a78bfa"/>
        <polygon points="27,10 22,3 31,8" fill="#fca5a5"/>
        <polygon points="66,12 72,0 56,8" fill="#a78bfa"/>
        <polygon points="63,10 68,3 59,8" fill="#fca5a5"/>
        <ellipse cx="36" cy="25" rx="5" ry="6" fill="#1a1a1a"/>
        <ellipse cx="54" cy="25" rx="5" ry="6" fill="#1a1a1a"/>
        <circle cx="37" cy="23" r="2" fill="#fff"/><circle cx="55" cy="23" r="2" fill="#fff"/>
        <polygon points="45,33 42,37 48,37" fill="#fca5a5"/>
        <line x1="20" y1="34" x2="38" y2="36" stroke="#1a1a1a" strokeWidth="1.5"/>
        <line x1="20" y1="38" x2="38" y2="38" stroke="#1a1a1a" strokeWidth="1.5"/>
        <line x1="52" y1="36" x2="70" y2="34" stroke="#1a1a1a" strokeWidth="1.5"/>
        <line x1="52" y1="38" x2="70" y2="38" stroke="#1a1a1a" strokeWidth="1.5"/>
        <path d="M83 70 Q110 50 105 30 Q100 15 88 20" stroke="#a78bfa" strokeWidth="6" fill="none" strokeLinecap="round"/>
      </g>

      {/* Flowers bottom-right */}
      <g opacity="0.18" transform="translate(1100,395)">
        {[20,55].map((x, i) => {
          const colors = ['#fb7185','#a5f3fc']
          const centers = ['#fbbf24','#f97316']
          return (
            <g key={x}>
              <line x1={x} y1="80" x2={x} y2="42" stroke="#16a34a" strokeWidth="4" strokeLinecap="round"/>
              <circle cx={x} cy="30" r="12" fill={colors[i]}/>
              {[0,90,180,270].map((deg, j) => {
                const r = (deg * Math.PI) / 180
                return <circle key={j} cx={x+12*Math.sin(r)} cy={30-12*Math.cos(r)} r="6" fill={colors[i]}/>
              })}
              <circle cx={x} cy="30" r="7" fill={centers[i]}/>
            </g>
          )
        })}
        <path d="M0,80 Q55,68 110,80" stroke="#16a34a" strokeWidth="4" fill="none" strokeLinecap="round"/>
      </g>

      {/* Stars */}
      {[[500,50],[580,90],[900,60],[450,480],[980,470]].map(([x,y],i) => (
        <text key={i} x={x} y={y} fontSize="22" fill="#fbbf24" opacity="0.18">★</text>
      ))}

      {/* Butterfly top-right */}
      <g opacity="0.2" transform="translate(1230,80)">
        <ellipse cx="30" cy="20" rx="28" ry="18" fill="#fca5a5" transform="rotate(-30 30 20)"/>
        <ellipse cx="30" cy="35" rx="22" ry="15" fill="#fca5a5" transform="rotate(20 30 35)"/>
        <ellipse cx="30" cy="20" rx="28" ry="18" fill="#a5f3fc" transform="rotate(210 30 20)"/>
        <ellipse cx="30" cy="35" rx="22" ry="15" fill="#a5f3fc" transform="rotate(160 30 35)"/>
        <ellipse cx="30" cy="27" rx="4" ry="14" fill="#1a1a1a"/>
        <path d="M28 14 Q20 4 14 2" stroke="#1a1a1a" strokeWidth="1.5" fill="none"/>
        <path d="M32 14 Q40 4 46 2" stroke="#1a1a1a" strokeWidth="1.5" fill="none"/>
        <circle cx="14" cy="2" r="3" fill="#f97316"/>
        <circle cx="46" cy="2" r="3" fill="#f97316"/>
      </g>

      <rect x="10" y="10" width="1380" height="540" rx="12" fill="none" stroke="#f97316" strokeWidth="3" strokeDasharray="14,10" opacity="0.1"/>
    </svg>
  )
}
