import ScallopDivider from '@/components/ScallopDivider'
import HeroBookshelf from '@/components/HeroBookshelf'
import WelcomeBonusModal from '@/components/WelcomeBonusModal'
import Link from 'next/link'

export default async function HomePage() {
  return (
    <>
      <WelcomeBonusModal />

      {/* Hero */}
      <section className="bg-cream" style={{ padding: '48px 16px 72px' }}>
        <HeroBookshelf />
      </section>

      {/* How It Works */}
      <ScallopDivider color="#0d9488" bgColor="#fffbf0" direction="down" />
      <section id="how-it-works" className="bg-[#ecfdf5] px-4 md:px-10 pt-5 pb-[60px] text-center">
        <h2 className="font-display text-[30px] mb-1.5">How it works 🏡</h2>
        <p className="text-[#6b7280] text-[15px] font-semibold mb-10">As simple as a little free library — just online.</p>
        <div className="grid grid-cols-2 md:flex gap-5 justify-center max-w-[900px] mx-auto">
          {[
            { n: 1, icon: '🏙️', title: 'Set your city', desc: 'Create a free account and set your city to see books near you.' },
            { n: 2, icon: '📚', title: 'Browse or post', desc: 'Browse listings for free. Post books to sell or give away.' },
            { n: 3, icon: '💬', title: 'Message a neighbor', desc: 'Message the seller to arrange a local meetup.' },
            { n: 4, icon: '🤝', title: 'Meet & exchange', desc: 'Meet locally and swap the book however works for you both.' },
          ].map(s => (
            <div
              key={s.n}
              className="bg-white rounded-[20px] p-[20px_14px] md:p-[26px_18px] md:flex-1 md:max-w-[205px] border-[3px] border-[#d1fae5] shadow-[0_5px_0_#a7f3d0] text-center"
            >
              <div className="w-[38px] h-[38px] bg-bk-orange text-white font-display text-lg rounded-full flex items-center justify-center mx-auto mb-3 shadow-[0_3px_0_#c2410c]">
                {s.n}
              </div>
              <div className="text-[34px] mb-2.5">{s.icon}</div>
              <h3 className="text-[15px] font-black mb-1.5">{s.title}</h3>
              <p className="text-[13px] text-[#777] leading-relaxed font-semibold">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>
      <ScallopDivider color="#0d9488" bgColor="#fffbf0" direction="up" />

      {/* CTA Band */}
      <section className="bg-bk-orange py-[50px] px-4 md:px-8 text-center relative overflow-hidden">
        <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 1400 220" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
          <g opacity="0.15">
            <text x="80" y="60" fontSize="30" fill="#fff">★</text>
            <text x="200" y="160" fontSize="20" fill="#fff">★</text>
            <text x="1250" y="50" fontSize="28" fill="#fff">★</text>
            <text x="1100" y="170" fontSize="18" fill="#fff">★</text>
            <circle cx="350" cy="110" r="18" fill="#fff"/>
            <circle cx="350" cy="88" r="9" fill="#fff"/>
            <circle cx="350" cy="132" r="9" fill="#fff"/>
            <circle cx="328" cy="110" r="9" fill="#fff"/>
            <circle cx="372" cy="110" r="9" fill="#fff"/>
            <circle cx="350" cy="110" r="11" fill="#f97316"/>
            <circle cx="1050" cy="110" r="16" fill="#fff"/>
            <circle cx="1050" cy="90" r="8" fill="#fff"/>
            <circle cx="1050" cy="130" r="8" fill="#fff"/>
            <circle cx="1030" cy="110" r="8" fill="#fff"/>
            <circle cx="1070" cy="110" r="8" fill="#fff"/>
            <circle cx="1050" cy="110" r="10" fill="#f97316"/>
            <circle cx="700" cy="40" r="24" fill="#fbbf24" opacity="0.6"/>
            <line x1="700" y1="8" x2="700" y2="16" stroke="#fbbf24" strokeWidth="4" opacity="0.6"/>
            <line x1="700" y1="64" x2="700" y2="72" stroke="#fbbf24" strokeWidth="4" opacity="0.6"/>
            <line x1="668" y1="40" x2="676" y2="40" stroke="#fbbf24" strokeWidth="4" opacity="0.6"/>
            <line x1="724" y1="40" x2="732" y2="40" stroke="#fbbf24" strokeWidth="4" opacity="0.6"/>
          </g>
        </svg>
        <div className="relative z-10">
          <div className="text-[30px] mb-[22px] flex justify-center gap-4 flex-wrap">🌸 🌻 🌈 ☀️ 🌼 🌿 🌷</div>
          <h2 className="font-display text-[28px] text-white mb-3">Your neighborhood deserves a little free library.</h2>
          <p className="text-[#fff7ed] text-base font-bold mb-6">Join your neighbors and start sharing books today — free to browse, free to join.</p>
          <Link
            href="/auth/signup"
            className="bg-bk-teal text-white px-8 py-3 rounded-full font-extrabold shadow-[0_4px_0_#0f766e] hover:shadow-[0_2px_0_#0f766e] hover:translate-y-0.5 transition-all inline-block"
          >
            Join Your Community →
          </Link>
        </div>
      </section>
    </>
  )
}
