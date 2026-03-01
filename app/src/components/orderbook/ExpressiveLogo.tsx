"use client";

import { useEffect, useRef, useState } from "react";

const ASCII_ART = [
  "┌─┐ ─┼─ ┌─┐ ┬─┐ ┌─┐ ┌─┐ ┌─┐  ┬  ┬  ┬ ┌─┐",
  "├─   │  ├─┘ ├┬┘ ├─  └─┐ └─┐  │  └┬┘  │ ├─",
  "└─┘ ─┴─ ┴   ┴└─ └─┘ └─┘ └─┘  ┴   ┴  └┘ └─┘",
];

const SCRAMBLE_CHARS = "█▓▒░│─┼┐└┘┌╔╗╚╝╠╣╦╩╬▀▄";
const TICK_MS = 30;
const STAGGER_PER_CHAR = 2; // ticks between each char starting to reveal
const SETTLE_TICKS = 8; // ticks of scrambling before char settles

function randomScrambleChar() {
  return SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
}

export function ExpressiveLogo() {
  const [lines, setLines] = useState<string[]>(ASCII_ART.map(() => ""));
  const [done, setDone] = useState(false);
  const tickRef = useRef(0);

  useEffect(() => {
    // Flatten all chars across lines into one array with metadata
    type CharSlot = { line: number; col: number; target: string };
    const slots: CharSlot[] = [];
    ASCII_ART.forEach((line, li) => {
      for (let ci = 0; ci < line.length; ci++) {
        slots.push({ line: li, col: ci, target: line[ci] });
      }
    });

    const totalSlots = slots.length;

    const id = setInterval(() => {
      const tick = tickRef.current++;

      // Build output lines
      const output = ASCII_ART.map((line) => new Array(line.length).fill(" "));

      let allSettled = true;

      for (let i = 0; i < totalSlots; i++) {
        const { line, col, target } = slots[i];
        const startTick = i * STAGGER_PER_CHAR;
        const settleAt = startTick + SETTLE_TICKS;

        if (tick < startTick) {
          // Not started yet — show space
          output[line][col] = " ";
          allSettled = false;
        } else if (tick < settleAt) {
          // Scrambling
          output[line][col] = target === " " ? " " : randomScrambleChar();
          allSettled = false;
        } else {
          // Settled
          output[line][col] = target;
        }
      }

      setLines(output.map((chars) => chars.join("")));

      if (allSettled) {
        clearInterval(id);
        setDone(true);
      }
    }, TICK_MS);

    return () => clearInterval(id);
  }, []);

  return (
    <div className="px-3 py-3 select-none">
      <pre className="text-terminal-green text-[10px] leading-snug font-mono">
        {lines.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
        {done && (
          <span className="animate-blink">█</span>
        )}
      </pre>
      <p className="text-terminal-muted text-[9px] tracking-widest mt-1 font-mono">
        constraint-based lending · monad
      </p>
    </div>
  );
}
