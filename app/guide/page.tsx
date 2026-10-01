import Image from "next/image";
import Link from "next/link";
import PageNavigation from "@/components/PageNavigation";
export default function GuidePage() {
  return (
    <div className="app app--guide">
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
        <PageNavigation current="guide" />
      </header>
      <main className="guide-scroll">
        <div className="guide-page">
          <p className="flow-eyebrow">GUIDE</p>
          <h1>使い方</h1>
          <p className="flow-lead">
            標準メニューを任せるなら自動進行。必要な案内だけ使うなら個別進行。
          </p>
          <section className="flow-surface">
            <span className="guide-number">01 / 準備</span>
            <h2>最初にコート数を選ぶ</h2>
            <p>
              進行画面の上部で1面・2面を選びます。音量とチャイムは右上のメニューから「設定」を開いて確認してください。ずんだもんの案内は事前生成済みなので、通常の利用時にVOICEVOXを起動する必要はありません。
            </p>
          </section>
          <section className="flow-surface">
            <span className="guide-number">02 / 自動進行</span>
            <h2>時計と案内を一緒に操作</h2>
            <dl className="guide-operations">
              <dt>▶ 自動進行を開始</dt>
              <dd>
                標準2時間メニューを開始します。時間に合わせてチャイムと案内が流れます。
              </dd>
              <dt>⏸ 一時停止 → ▶ 再開</dt>
              <dd>
                時計と途中の案内を両方止めます。再開すると、時計と案内が止めたところから続きます。チャイム中に止めた場合は、再開時にチャイムから流します。
              </dd>
              <dt>項目へ移動</dt>
              <dd>
                「次のメニュー」や「進行メニュー」の項目を選ぶと、その開始時刻へ移動します。進行中なら新しい項目を案内し、一時停止中ならその項目で待機します。再開すると選んだ項目の案内が流れます。
              </dd>
              <dt>⏹ 終了</dt>
              <dd>
                時計と音声を終了して、開催準備に戻ります。誤操作を防ぐため、確認後に終了します。
              </dd>
            </dl>
            <p className="guide-note">
              音声だけの停止・聞き直しボタンはありません。同じ項目の最初からやり直す場合も、進行メニューでその項目を選びます。
            </p>
          </section>
          <section className="flow-surface">
            <span className="guide-number">03 / 個別進行</span>
            <h2>項目を選んで再生</h2>
            <p>
              「案内を選ぶ」や左右の矢印で項目を選び、「この案内を再生」を押します。再生中は同じボタンで一時停止、停止後は続きから再生できます。別の項目を選ぶと、前の音声は終了します。時間に沿った自動切り替えはありません。
            </p>
            <p>
              個別進行だけに「補助ツール」を用意しています。練習タイマーと6種類の声かけを必要なときに使えます。声かけは選んだボタンで再生し、同じボタンでもう一度押すと止まります。
            </p>
          </section>
          <section className="flow-surface">
            <span className="guide-number">04 / 画面移動</span>
            <h2>離れるときも全体を一時停止</h2>
            <p>
              個別進行や別ページへ移動したり、画面を非表示にすると、自動進行の時計と音声を一緒に止めます。戻ったら「再開」で続けてください。メニューを開くだけ、音量を変えるだけでは進行は止まりません。
            </p>
            <p>
              読み込み直した場合も保存した進行位置で待機します。勝手に音が鳴ったり、過去の案内がまとめて流れたりすることはありません。ブラウザを閉じた場合は途中の音声を保持できないため、再開時に現在の案内を最初から流す場合があります。
            </p>
            <p className="guide-note">
              設定で音声やチャイムを試聴するときは、自動進行を一時停止します。試聴後は進行画面で「再開」してください。
            </p>
          </section>
          <section className="flow-surface">
            <span className="guide-number">05 / メニュー</span>
            <h2>右上からページと設定へ</h2>
            <p>
              右上の「メニュー」から、ホーム・進行・チャット・設定・使い方を選べます。Macはカーソルを合わせるかクリック、iPadはタップで開きます。キーボードでも操作でき、Escで閉じます。
            </p>
          </section>
          <section className="flow-surface">
            <span className="guide-number">06 / 困ったとき</span>
            <h2>音が出ないとき</h2>
            <p>
              本体とBluetoothスピーカーの音量・接続先を確認し、右上の設定でテスト再生を試してください。録音の読み込みに失敗した場合、自動進行は一時停止します。接続を確認して「再開」でやり直せます。
            </p>
            <p>
              音量は自動進行・個別進行・声かけで共通です。画面ロック中の案内は保証できないため、自動進行の画面を表示したまま使ってください。
            </p>
          </section>
          <Link className="flow-btn flow-btn--primary" href="/flow">
            進行を開く →
          </Link>
          <p className="flow-credit">音声: VOICEVOX:ずんだもん</p>
        </div>
      </main>
    </div>
  );
}
