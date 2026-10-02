import Image from "next/image";
import Link from "next/link";
import PageNavigation from "@/components/PageNavigation";

export default function SettingsIndexPage() {
  return (
    <div className="app app--settings-index">
      <header className="header">
        <Link href="/" className="header__brand" aria-label="うぃる HOMEへ">
          <div className="header__avatar">
            <Image src="/will.png" alt="うぃる" width={40} height={40} />
          </div>
          <div className="header__titles">
            <span className="header__title">うぃる</span>
            <span className="header__subtitle">
              WILL.tennis 公式キャラクター
            </span>
          </div>
        </Link>
        <PageNavigation current="settings" />
      </header>
      <main className="home-scroll">
        <div className="settings-index-page">
          <header className="settings-index-heading">
            <p className="home-kicker">SETTINGS</p>
            <h1>設定</h1>
            <p>
              設定する機能を選んでください。内容はコンテンツごとに分けています。
            </p>
          </header>
          <div className="settings-index-grid">
            <Link href="/flow?settings=1">
              <span className="home-feature-card__tag">VOICE</span>
              <strong>進行の設定</strong>
              <p>音声音量、転換音、音声テスト</p>
              <span aria-hidden="true">→</span>
            </Link>
            <Link href="/chat?settings=1">
              <span className="home-feature-card__tag">CHAT</span>
              <strong>チャットの設定</strong>
              <p>読み上げ音声、音量など</p>
              <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
