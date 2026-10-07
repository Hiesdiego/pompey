"use client";

import "./TickrLoader.css";

const LETTERS = [
  { name: "t", left: 0, width: 22.908 },
  { name: "i", left: 25.265, width: 8.739 },
  { name: "c", left: 35.143, width: 23.517 },
  { name: "k", left: 60.328, width: 20.101 },
  { name: "r", left: 81.568, width: 18.432 },
] as const;

export default function TickrLoader() {
  return (
    <div className="tickr-loader" role="status" aria-label="Loading TICKR">
      <span className="tickr-loader__mark" role="img" aria-label="TICKR">
        <span className="tickr-loader__letters">
          {LETTERS.map((letter, index) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={letter.name}
              src={`/loader/letter-${letter.name}-light.png`}
              alt=""
              aria-hidden="true"
              draggable={false}
              className="tickr-loader__letter"
              style={{ left: `${letter.left}%`, width: `${letter.width}%`, animationDelay: `${index * 0.12}s` }}
            />
          ))}
        </span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/loader/tickr-loader-crown.png"
          alt=""
          aria-hidden="true"
          draggable={false}
          className="tickr-loader__crown"
        />
      </span>
    </div>
  );
}
