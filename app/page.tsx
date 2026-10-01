import Image from "next/image";
import Link from "next/link";
import PageNavigation from "@/components/PageNavigation";

export default function HomePage() {
  return (
    <div className="app app--home">
      <header className="header">
        <Link href="/" className="header__brand" aria-label="うぃる HOMEへ">
          <div className="header__avatar">
            <Image
              src="/will.png"
              alt="うぃる"
              width={40}
              height={40}
              priority
            />
          </div>
          <div className="header__titles">
            <span className="header__title">うぃる</span>
            <span className="header__subtitle">
              WILL.tennis 公式キャラクター
            </span>
          </div>
        </Link>
        <PageNavigation current="home" />
      </header>
      <main className="home-scroll">
        <div className="home-page">
          <section className="home-hero" aria-labelledby="will-home-title">
            <div className="home-hero__copy">
              <p className="home-kicker">WILL.TENNIS OFFICIAL CHARACTER</p>
              <h1 id="will-home-title">うぃる</h1>
              <p>WILL.tennisの活動に寄り添う、公式キャラクター。</p>
            </div>
            <Image
              className="home-hero__character"
              src="/will.png"
              alt="うぃる"
              width={116}
              height={116}
              priority
            />
          </section>

          <section
            className="home-section"
            aria-labelledby="home-contents-title"
          >
            <div className="home-section__heading">
              <div>
                <p>CONTENTS</p>
                <h2 id="home-contents-title">できること</h2>
              </div>
              <span>うぃると一緒に</span>
            </div>
            <div className="home-feature-grid">
              <Link
                className="home-feature-card home-feature-card--primary"
                href="/flow"
              >
                <span className="home-feature-card__tag">VOICE</span>
                <strong>進行アシスタント</strong>
                <p>WILL.tennisの進行を、音声でサポート。</p>
                <span className="home-feature-card__arrow" aria-hidden="true">
                  →
                </span>
              </Link>
              <Link className="home-feature-card" href="/chat">
                <span className="home-feature-card__tag">CHAT</span>
                <strong>チャット</strong>
                <p>うぃると会話して、開催中の疑問やルールを確認。</p>
                <span className="home-feature-card__arrow" aria-hidden="true">
                  →
                </span>
              </Link>
            </div>
          </section>

          <section
            className="home-section home-utility"
            aria-labelledby="home-support-title"
          >
            <div className="home-section__heading">
              <div>
                <p>SUPPORT</p>
                <h2 id="home-support-title">サポート</h2>
              </div>
            </div>
            <div className="home-utility-list">
              <Link href="/settings">
                <span className="home-utility-icon" aria-hidden="true">
                  ⚙
                </span>
                <span>
                  <strong>設定</strong>
                  <small>進行・チャット、それぞれの設定へ</small>
                </span>
                <span aria-hidden="true">→</span>
              </Link>
              <Link href="/guide">
                <span className="home-utility-icon" aria-hidden="true">
                  ?
                </span>
                <span>
                  <strong>使い方</strong>
                  <small>はじめて使うときはこちら</small>
                </span>
                <span aria-hidden="true">→</span>
              </Link>
            </div>
          </section>

        </div>
      </main>
    </div>
  );
}
