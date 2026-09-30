import Image from "next/image";
import Link from "next/link";
import PageNavigation from "@/components/PageNavigation";
export default function GuidePage() {
  return (
    <div className="app app--guide">
      <header className="header">
        <div className="header__avatar">
          <Image src="/will.png" alt="うぃる" width={40} height={40} />
        </div>
        <div className="header__titles">
          <span className="header__title">うぃる進行</span>
          <span className="header__subtitle">WILL.tennis 進行アシスタント</span>
        </div>
      </header>
      <main className="guide-scroll">
        <div className="guide-page">
          <p className="flow-eyebrow">QUICK GUIDE</p>
          <h1>うぃる進行の使い方</h1>
          <p className="flow-lead">
            進行方法は、自動進行と個別進行の2種類です。
          </p>
          <section className="flow-surface">
            <span className="guide-number">01</span>
            <h2>自動進行とは</h2>
            <p>
              標準2時間メニューを、時計に沿って進めます。コート数を選び、音声テストをしてから「自動進行を開始」を押してください。
            </p>
            <ul>
              <li>
                メニューが切り替わるとチャイムが鳴り、続いてずんだもんが案内します。チャイムは開始前にON/OFFを選べます。
              </li>
              <li>
                現在のメニュー、経過時間、進捗、残り時間、次・その次のメニューを画面の上部で確認できます。
              </li>
              <li>
                「進行を一時停止」で時計を止め、「進行を再開」で続けられます。
              </li>
              <li>
                「全体の流れを見る」を開き、メニューを押すと、そのメニューへ移動できます。進行中は確認が表示されます。
              </li>
            </ul>
            <p className="guide-note">
              全体の自己紹介はゲーム前です。乱数表 → 試合ルール → 自己紹介 →
              ゲーム開始の順に進みます。
            </p>
          </section>
          <section className="flow-surface">
            <span className="guide-number">02</span>
            <h2>個別進行とは</h2>
            <p>
              STEP一覧や「前へ」「次へ」で必要な案内を選び、「もう一度聞く」を押します。好きなタイミングで再生できるので、開催内容が標準と違う場合に便利です。
            </p>
            <p>
              各案内は12STEPに分かれています。「コート数・案内を調整」から、1面・2面を選んだり案内文を編集できます。
            </p>
          </section>
          <section className="flow-surface">
            <span className="guide-number">03</span>
            <h2>開催当日のおすすめ</h2>
            <div className="guide-recommend">
              <span>標準2時間の開催</span>
              <strong>→ 自動進行</strong>
            </div>
            <div className="guide-recommend">
              <span>変則開催・時間変更あり</span>
              <strong>→ 個別進行</strong>
            </div>
            <p>
              開始前にBluetoothスピーカーの接続と音量を確認し、「音声テスト」を試しましょう。
            </p>
          </section>
          <section className="flow-surface">
            <span className="guide-number">04</span>
            <h2>音声操作</h2>
            <dl className="guide-operations">
              <dt>もう一度聞く</dt>
              <dd>表示中のメニューの案内を、最初から再生します。</dd>
              <dt>音声を一時停止</dt>
              <dd>
                個別進行では音声だけを止め、「音声を再開」で続きから再生できます。
              </dd>
              <dt>音声を止める</dt>
              <dd>
                音声とチャイムを止めます。自動進行の時計は続き、次のメニューで案内が流れます。
              </dd>
              <dt>進行を一時停止</dt>
              <dd>
                自動進行の時計と今の音声を止めます。再開時に過去の案内は流れません。必要なら「もう一度聞く」を押してください。
              </dd>
              <dt>自動進行を終了</dt>
              <dd>
                時計と音声を止め、開催の保存データを消して開始前の画面に戻ります。
              </dd>
              <dt>チャイム</dt>
              <dd>自動進行の切替を知らせます。開始前に試聴できます。</dd>
            </dl>
          </section>
          <section className="flow-surface">
            <span className="guide-number">05</span>
            <h2>途中で画面を切り替えた場合</h2>
            <p>
              個別進行・使い方・うぃるに聞くへ移動すると、鳴っている音声は止まります。自動進行の時計は維持しますが、自動進行画面から離れている間は、自動の音声案内は鳴りません。
            </p>
            <p>
              戻ると現在の時刻に合わせて進行を表示します。ページを読み込み直しても、開始時刻や一時停止の状態を復元します。過去の案内がまとめて流れることはありません。
            </p>
            <p className="guide-note">
              画面を閉じたりロックすると、音声が止まる場合があります。案内を確実に流すには、自動進行の画面を開いたまま使ってください。
            </p>
          </section>
          <section className="flow-surface">
            <span className="guide-number">06</span>
            <h2>困ったとき</h2>
            <ul>
              <li>
                音が出ないときは、スマホ本体とスピーカー両方の音量を確認してください。
              </li>
              <li>
                Bluetoothスピーカーが別の機器につながっていないか確認してください。
              </li>
              <li>
                「音声テスト」や「もう一度聞く」を押してください。ブラウザに再生許可の確認が出たら許可してください。
              </li>
              <li>
                音量は画面右上の「設定」→「音声音量」で調整できます。録音音声とチャイムは再生中にも変わり、次の再生・読み込み直し後も維持します。
              </li>
              <li>
                誤って移動したら、タイムラインから必要なメニューへ戻れます。
              </li>
              <li>
                最初からやり直す場合は、画面下部の「自動進行を終了」を押してください。
              </li>
            </ul>
          </section>
          <Link className="flow-btn flow-btn--primary guide-start" href="/flow">
            進行を開く →
          </Link>
          <p className="flow-credit">音声: VOICEVOX:ずんだもん</p>
        </div>
      </main>
      <PageNavigation current="guide" />
    </div>
  );
}
