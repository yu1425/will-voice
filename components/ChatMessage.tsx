/**
 * チャットの吹き出し1件分
 * ------------------------------------------------------------
 * LINEのトーク画面に近い見た目にしています。
 *   - うぃる(role: "will")  : 左寄せ・アイコン付き・白い吹き出し
 *   - ユーザー  (role: "user")  : 右寄せ・緑の吹き出し
 */

import Image from "next/image";

export type ChatRole = "user" | "will";

export type ChatMessageData = {
  id: string;
  role: ChatRole;
  text: string;
};

type Props = {
  message: ChatMessageData;
};

export default function ChatMessage({ message }: Props) {
  const isWill = message.role === "will";

  return (
    <div className={`msg-row ${isWill ? "msg-row--will" : "msg-row--user"}`}>
      {isWill && (
        <div className="msg-avatar">
          <Image src="/will.png" alt="うぃる" width={36} height={36} />
        </div>
      )}

      <div className="msg-bubble-wrap">
        {isWill && <span className="msg-name">うぃる</span>}
        <div className={`msg-bubble ${isWill ? "msg-bubble--will" : "msg-bubble--user"}`}>
          {/* 改行をそのまま表示する */}
          {message.text.split("\n").map((line, i) => (
            <span key={i}>
              {line}
              {i < message.text.split("\n").length - 1 && <br />}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
