export default function KidDrawingBackground() {
  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none"
      viewBox="0 0 1400 560"
      preserveAspectRatio="xMidYMid slice"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* House left */}
      <g opacity="0.22" transform="translate(30,180)">
        <polygon points="10,60 70,10 130,60" fill="#f97316" stroke="#f97316" strokeWidth="3" strokeLinejoin="round"/>
        <rect x="85" y="15" width="16" height="28" fill="#fca5a5" rx="3"/>
        <circle cx="93" cy="8" r="6" fill="#e5e7eb"/>
        <circle cx="100" cy="2" r="5" fill="#e5e7eb"/>
        <rect x="20" y="58" width="100" height="70" fill="#fff7ed" stroke="#f97316" strokeWidth="3" rx="4"/>
        <rect x="55" y="90" width="30" height="38" fill="#0d9488" rx="4"/>
        <circle cx="80" cy="110" r="3" fill="#fbbf24"/>
        <rect x="28" y="70" width="22" height="20" fill="#bfdbfe" rx="3" stroke="#3b82f6" strokeWidth="2"/>
        <line x1="39" y1="70" x2="39" y2="90" stroke="#3b82f6" strokeWidth="1.5"/>
        <line x1="28" y1="80" x2="50" y2="80" stroke="#3b82f6" strokeWidth="1.5"/>
        <rect x="90" y="70" width="22" height="20" fill="#bfdbfe" rx="3" stroke="#3b82f6" strokeWidth="2"/>
        <line x1="101" y1="70" x2="101" y2="90" stroke="#3b82f6" strokeWidth="1.5"/>
        <line x1="90" y1="80" x2="112" y2="80" stroke="#3b82f6" strokeWidth="1.5"/>
        <path d="M0,128 Q35,118 70,128 Q105,118 140,128" stroke="#16a34a" strokeWidth="4" fill="none" strokeLinecap="round"/>
      </g>

      {/* Sun top-left */}
      <g opacity="0.25" transform="translate(60,30)">
        <circle cx="50" cy="50" r="35" fill="#fbbf24"/>
        <line x1="50" y1="5" x2="53" y2="18" stroke="#fbbf24" strokeWidth="5" strokeLinecap="round"/>
        <line x1="50" y1="82" x2="47" y2="95" stroke="#fbbf24" strokeWidth="5" strokeLinecap="round"/>
        <line x1="5" y1="50" x2="18" y2="53" stroke="#fbbf24" strokeWidth="5" strokeLinecap="round"/>
        <line x1="82" y1="50" x2="95" y2="47" stroke="#fbbf24" strokeWidth="5" strokeLinecap="round"/>
        <line x1="18" y1="18" x2="27" y2="27" stroke="#fbbf24" strokeWidth="5" strokeLinecap="round"/>
        <line x1="82" y1="82" x2="73" y2="73" stroke="#fbbf24" strokeWidth="5" strokeLinecap="round"/>
        <line x1="18" y1="82" x2="27" y2="73" stroke="#fbbf24" strokeWidth="5" strokeLinecap="round"/>
        <line x1="82" y1="18" x2="73" y2="27" stroke="#fbbf24" strokeWidth="5" strokeLinecap="round"/>
        <circle cx="40" cy="43" r="5" fill="#f97316"/>
        <circle cx="60" cy="43" r="5" fill="#f97316"/>
        <path d="M38 60 Q50 72 62 60" stroke="#f97316" strokeWidth="3.5" fill="none" strokeLinecap="round"/>
      </g>

      {/* Stick figure family */}
      <g opacity="0.2" transform="translate(170,200)">
        <circle cx="30" cy="14" r="12" fill="none" stroke="#f97316" strokeWidth="3"/>
        <circle cx="26" cy="12" r="2" fill="#f97316"/>
        <circle cx="34" cy="12" r="2" fill="#f97316"/>
        <path d="M26 18 Q30 22 34 18" stroke="#f97316" strokeWidth="2" fill="none" strokeLinecap="round"/>
        <line x1="30" y1="26" x2="30" y2="65" stroke="#f97316" strokeWidth="3.5" strokeLinecap="round"/>
        <line x1="30" y1="38" x2="5" y2="55" stroke="#f97316" strokeWidth="3" strokeLinecap="round"/>
        <line x1="30" y1="38" x2="65" y2="42" stroke="#f97316" strokeWidth="3" strokeLinecap="round"/>
        <line x1="30" y1="65" x2="15" y2="95" stroke="#f97316" strokeWidth="3.5" strokeLinecap="round"/>
        <line x1="30" y1="65" x2="45" y2="95" stroke="#f97316" strokeWidth="3.5" strokeLinecap="round"/>
        <rect x="18" y="2" width="24" height="8" fill="#f97316" rx="3"/>
        <rect x="14" y="-2" width="32" height="5" fill="#f97316" rx="2"/>
        <circle cx="80" cy="18" r="11" fill="none" stroke="#0d9488" strokeWidth="3"/>
        <circle cx="76" cy="16" r="2" fill="#0d9488"/>
        <circle cx="84" cy="16" r="2" fill="#0d9488"/>
        <path d="M76 22 Q80 26 84 22" stroke="#0d9488" strokeWidth="2" fill="none" strokeLinecap="round"/>
        <path d="M69 10 Q80 0 91 10" stroke="#fbbf24" strokeWidth="4" fill="none" strokeLinecap="round"/>
        <line x1="69" y1="10" x2="65" y2="22" stroke="#fbbf24" strokeWidth="3.5" strokeLinecap="round"/>
        <line x1="91" y1="10" x2="95" y2="22" stroke="#fbbf24" strokeWidth="3.5" strokeLinecap="round"/>
        <path d="M80 29 L60 90 L100 90 Z" fill="none" stroke="#0d9488" strokeWidth="3" strokeLinejoin="round"/>
        <line x1="80" y1="42" x2="55" y2="55" stroke="#0d9488" strokeWidth="2.5" strokeLinecap="round"/>
        <line x1="80" y1="42" x2="105" y2="50" stroke="#0d9488" strokeWidth="2.5" strokeLinecap="round"/>
        <circle cx="52" cy="42" r="9" fill="none" stroke="#fbbf24" strokeWidth="2.5"/>
        <circle cx="49" cy="40" r="1.5" fill="#fbbf24"/>
        <circle cx="55" cy="40" r="1.5" fill="#fbbf24"/>
        <path d="M49 46 Q52 49 55 46" stroke="#fbbf24" strokeWidth="2" fill="none" strokeLinecap="round"/>
        <line x1="52" y1="51" x2="52" y2="75" stroke="#fbbf24" strokeWidth="2.5" strokeLinecap="round"/>
        <line x1="52" y1="58" x2="40" y2="68" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round"/>
        <line x1="52" y1="58" x2="64" y2="65" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round"/>
        <line x1="52" y1="75" x2="44" y2="90" stroke="#fbbf24" strokeWidth="2.5" strokeLinecap="round"/>
        <line x1="52" y1="75" x2="60" y2="90" stroke="#fbbf24" strokeWidth="2.5" strokeLinecap="round"/>
      </g>

      {/* Rainbow */}
      <g opacity="0.2" transform="translate(320,20)">
        <path d="M10 90 Q80 10 150 90" stroke="#f97316" strokeWidth="9" fill="none" strokeLinecap="round"/>
        <path d="M20 90 Q80 22 140 90" stroke="#fbbf24" strokeWidth="8" fill="none" strokeLinecap="round"/>
        <path d="M30 90 Q80 34 130 90" stroke="#4ade80" strokeWidth="7" fill="none" strokeLinecap="round"/>
        <path d="M40 90 Q80 46 120 90" stroke="#3b82f6" strokeWidth="6" fill="none" strokeLinecap="round"/>
        <path d="M50 90 Q80 58 110 90" stroke="#a78bfa" strokeWidth="5" fill="none" strokeLinecap="round"/>
        <ellipse cx="10" cy="90" rx="16" ry="10" fill="#e5e7eb"/>
        <ellipse cx="0" cy="88" rx="10" ry="8" fill="#e5e7eb"/>
        <ellipse cx="150" cy="90" rx="16" ry="10" fill="#e5e7eb"/>
        <ellipse cx="160" cy="88" rx="10" ry="8" fill="#e5e7eb"/>
      </g>

      {/* Flower patch bottom-left */}
      <g opacity="0.22" transform="translate(30,400)">
        <line x1="20" y1="80" x2="20" y2="40" stroke="#16a34a" strokeWidth="4" strokeLinecap="round"/>
        <circle cx="20" cy="30" r="14" fill="#fca5a5"/>
        <circle cx="20" cy="16" r="7" fill="#fca5a5"/>
        <circle cx="20" cy="44" r="7" fill="#fca5a5"/>
        <circle cx="6" cy="30" r="7" fill="#fca5a5"/>
        <circle cx="34" cy="30" r="7" fill="#fca5a5"/>
        <circle cx="20" cy="30" r="8" fill="#fbbf24"/>
        <path d="M18 55 Q5 48 8 40" stroke="#16a34a" strokeWidth="3" fill="none" strokeLinecap="round"/>
        <line x1="55" y1="80" x2="55" y2="50" stroke="#16a34a" strokeWidth="4" strokeLinecap="round"/>
        <circle cx="55" cy="38" r="12" fill="#a5f3fc"/>
        <circle cx="55" cy="26" r="6" fill="#a5f3fc"/>
        <circle cx="55" cy="50" r="6" fill="#a5f3fc"/>
        <circle cx="43" cy="38" r="6" fill="#a5f3fc"/>
        <circle cx="67" cy="38" r="6" fill="#a5f3fc"/>
        <circle cx="55" cy="38" r="7" fill="#f97316"/>
        <line x1="88" y1="80" x2="88" y2="45" stroke="#16a34a" strokeWidth="4" strokeLinecap="round"/>
        <circle cx="88" cy="32" r="13" fill="#fde68a"/>
        <circle cx="88" cy="19" r="6" fill="#fde68a"/>
        <circle cx="88" cy="45" r="6" fill="#fde68a"/>
        <circle cx="75" cy="32" r="6" fill="#fde68a"/>
        <circle cx="101" cy="32" r="6" fill="#fde68a"/>
        <circle cx="88" cy="32" r="8" fill="#0d9488"/>
        <path d="M0,80 Q50,70 120,80" stroke="#16a34a" strokeWidth="4" fill="none" strokeLinecap="round"/>
      </g>

      {/* Rain cloud top-right */}
      <g opacity="0.2" transform="translate(1100,25)">
        <ellipse cx="60" cy="35" rx="50" ry="28" fill="#e0f2fe"/>
        <ellipse cx="35" cy="42" rx="30" ry="22" fill="#e0f2fe"/>
        <ellipse cx="85" cy="40" rx="35" ry="22" fill="#e0f2fe"/>
        <ellipse cx="110" cy="45" rx="25" ry="18" fill="#e0f2fe"/>
        <line x1="40" y1="64" x2="36" y2="80" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round"/>
        <line x1="60" y1="63" x2="56" y2="79" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round"/>
        <line x1="80" y1="62" x2="76" y2="78" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round"/>
        <line x1="100" y1="63" x2="96" y2="79" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round"/>
      </g>

      {/* Butterfly top-right */}
      <g opacity="0.22" transform="translate(1230,80)">
        <ellipse cx="30" cy="20" rx="28" ry="18" fill="#fca5a5" transform="rotate(-30 30 20)"/>
        <ellipse cx="30" cy="20" rx="20" ry="14" fill="#fb7185" opacity="0.5" transform="rotate(-30 30 20)"/>
        <ellipse cx="30" cy="35" rx="22" ry="15" fill="#fca5a5" transform="rotate(20 30 35)"/>
        <ellipse cx="30" cy="35" rx="14" ry="10" fill="#fb7185" opacity="0.5" transform="rotate(20 30 35)"/>
        <ellipse cx="30" cy="20" rx="28" ry="18" fill="#a5f3fc" transform="rotate(210 30 20)"/>
        <ellipse cx="30" cy="20" rx="20" ry="14" fill="#22d3ee" opacity="0.5" transform="rotate(210 30 20)"/>
        <ellipse cx="30" cy="35" rx="22" ry="15" fill="#a5f3fc" transform="rotate(160 30 35)"/>
        <ellipse cx="30" cy="35" rx="14" ry="10" fill="#22d3ee" opacity="0.5" transform="rotate(160 30 35)"/>
        <ellipse cx="30" cy="27" rx="4" ry="14" fill="#1a1a1a"/>
        <path d="M28 14 Q20 4 14 2" stroke="#1a1a1a" strokeWidth="1.5" fill="none"/>
        <path d="M32 14 Q40 4 46 2" stroke="#1a1a1a" strokeWidth="1.5" fill="none"/>
        <circle cx="14" cy="2" r="3" fill="#f97316"/>
        <circle cx="46" cy="2" r="3" fill="#f97316"/>
      </g>

      {/* House right */}
      <g opacity="0.2" transform="translate(1200,190)">
        <polygon points="10,55 75,5 140,55" fill="#0d9488" stroke="#0d9488" strokeWidth="3" strokeLinejoin="round"/>
        <rect x="85" y="8" width="14" height="30" fill="#fca5a5" rx="2"/>
        <circle cx="92" cy="3" r="7" fill="#e5e7eb"/>
        <circle cx="98" cy="-2" r="5" fill="#e5e7eb"/>
        <rect x="20" y="53" width="110" height="75" fill="#fffbf0" stroke="#0d9488" strokeWidth="3" rx="3"/>
        <rect x="55" y="88" width="28" height="40" fill="#f97316" rx="4"/>
        <circle cx="79" cy="109" r="3" fill="#fff"/>
        <rect x="26" y="64" width="22" height="20" fill="#bfdbfe" rx="3" stroke="#3b82f6" strokeWidth="2"/>
        <line x1="37" y1="64" x2="37" y2="84" stroke="#3b82f6" strokeWidth="1.5"/>
        <line x1="26" y1="74" x2="48" y2="74" stroke="#3b82f6" strokeWidth="1.5"/>
        <rect x="95" y="64" width="22" height="20" fill="#bfdbfe" rx="3" stroke="#3b82f6" strokeWidth="2"/>
        <line x1="106" y1="64" x2="106" y2="84" stroke="#3b82f6" strokeWidth="1.5"/>
        <line x1="95" y1="74" x2="117" y2="74" stroke="#3b82f6" strokeWidth="1.5"/>
        <path d="M0,128 Q35,118 75,128 Q110,118 148,128" stroke="#16a34a" strokeWidth="4" fill="none" strokeLinecap="round"/>
      </g>

      {/* Cat bottom-right */}
      <g opacity="0.2" transform="translate(1290,380)">
        <ellipse cx="45" cy="65" rx="38" ry="30" fill="#a78bfa"/>
        <circle cx="45" cy="28" r="24" fill="#a78bfa"/>
        <polygon points="24,12 18,0 34,8" fill="#a78bfa"/>
        <polygon points="27,10 22,3 31,8" fill="#fca5a5"/>
        <polygon points="66,12 72,0 56,8" fill="#a78bfa"/>
        <polygon points="63,10 68,3 59,8" fill="#fca5a5"/>
        <ellipse cx="36" cy="25" rx="5" ry="6" fill="#1a1a1a"/>
        <ellipse cx="54" cy="25" rx="5" ry="6" fill="#1a1a1a"/>
        <circle cx="37" cy="23" r="2" fill="#fff"/>
        <circle cx="55" cy="23" r="2" fill="#fff"/>
        <polygon points="45,33 42,37 48,37" fill="#fca5a5"/>
        <path d="M42 37 Q45 42 48 37" stroke="#1a1a1a" strokeWidth="1.5" fill="none"/>
        <line x1="20" y1="34" x2="38" y2="36" stroke="#1a1a1a" strokeWidth="1.5"/>
        <line x1="20" y1="38" x2="38" y2="38" stroke="#1a1a1a" strokeWidth="1.5"/>
        <line x1="52" y1="36" x2="70" y2="34" stroke="#1a1a1a" strokeWidth="1.5"/>
        <line x1="52" y1="38" x2="70" y2="38" stroke="#1a1a1a" strokeWidth="1.5"/>
        <path d="M83 70 Q110 50 105 30 Q100 15 88 20" stroke="#a78bfa" strokeWidth="6" fill="none" strokeLinecap="round"/>
        <ellipse cx="25" cy="88" rx="12" ry="8" fill="#a78bfa"/>
        <ellipse cx="65" cy="88" rx="12" ry="8" fill="#a78bfa"/>
      </g>

      {/* Flowers bottom-right */}
      <g opacity="0.2" transform="translate(1100,390)">
        <line x1="20" y1="80" x2="20" y2="38" stroke="#16a34a" strokeWidth="4" strokeLinecap="round"/>
        <circle cx="20" cy="26" r="13" fill="#fb7185"/>
        <circle cx="20" cy="13" r="6" fill="#fb7185"/>
        <circle cx="20" cy="39" r="6" fill="#fb7185"/>
        <circle cx="7" cy="26" r="6" fill="#fb7185"/>
        <circle cx="33" cy="26" r="6" fill="#fb7185"/>
        <circle cx="20" cy="26" r="7" fill="#fbbf24"/>
        <line x1="55" y1="80" x2="55" y2="42" stroke="#16a34a" strokeWidth="4" strokeLinecap="round"/>
        <circle cx="55" cy="30" r="13" fill="#a5f3fc"/>
        <circle cx="55" cy="17" r="6" fill="#a5f3fc"/>
        <circle cx="55" cy="43" r="6" fill="#a5f3fc"/>
        <circle cx="42" cy="30" r="6" fill="#a5f3fc"/>
        <circle cx="68" cy="30" r="6" fill="#a5f3fc"/>
        <circle cx="55" cy="30" r="7" fill="#f97316"/>
        <path d="M0,80 Q55,68 110,80" stroke="#16a34a" strokeWidth="4" fill="none" strokeLinecap="round"/>
      </g>

      {/* Stars */}
      <g opacity="0.18">
        <text x="500" y="50" fontSize="26" fill="#fbbf24">★</text>
        <text x="580" y="90" fontSize="18" fill="#f97316">★</text>
        <text x="900" y="60" fontSize="22" fill="#fbbf24">★</text>
        <text x="820" y="110" fontSize="15" fill="#0d9488">★</text>
        <text x="450" y="480" fontSize="20" fill="#fbbf24">★</text>
        <text x="980" y="470" fontSize="24" fill="#f97316">★</text>
        <text x="650" y="500" fontSize="16" fill="#0d9488">★</text>
      </g>

      {/* Bird top-center */}
      <g opacity="0.2" transform="translate(680,40)">
        <ellipse cx="30" cy="22" rx="22" ry="14" fill="#fbbf24"/>
        <circle cx="50" cy="16" r="12" fill="#fbbf24"/>
        <polygon points="62,15 72,18 62,21" fill="#f97316"/>
        <circle cx="54" cy="13" r="3.5" fill="#1a1a1a"/>
        <circle cx="55" cy="12" r="1.5" fill="#fff"/>
        <path d="M22 18 Q10 5 8 22 Q18 28 30 22Z" fill="#f97316"/>
        <path d="M8 22 Q0 15 2 8" stroke="#f97316" strokeWidth="4" fill="none" strokeLinecap="round"/>
        <path d="M8 22 Q0 22 0 28" stroke="#f97316" strokeWidth="4" fill="none" strokeLinecap="round"/>
        <line x1="32" y1="36" x2="28" y2="48" stroke="#f97316" strokeWidth="2" strokeLinecap="round"/>
        <line x1="28" y1="48" x2="22" y2="52" stroke="#f97316" strokeWidth="2" strokeLinecap="round"/>
        <line x1="28" y1="48" x2="30" y2="54" stroke="#f97316" strokeWidth="2" strokeLinecap="round"/>
        <line x1="42" y1="36" x2="46" y2="48" stroke="#f97316" strokeWidth="2" strokeLinecap="round"/>
        <line x1="46" y1="48" x2="40" y2="52" stroke="#f97316" strokeWidth="2" strokeLinecap="round"/>
        <line x1="46" y1="48" x2="50" y2="54" stroke="#f97316" strokeWidth="2" strokeLinecap="round"/>
      </g>

      {/* Dotted border frame */}
      <rect x="10" y="10" width="1380" height="540" rx="12" fill="none" stroke="#f97316" strokeWidth="3" strokeDasharray="14,10" opacity="0.12"/>
    </svg>
  )
}
