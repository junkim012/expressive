"use client";

import { useEffect, useReducer, useRef } from "react";
import type { LendOrder, BorrowOrder, Order, WsMessage } from "@/types";

interface OrderBookState {
  lendOrders: LendOrder[];
  borrowOrders: BorrowOrder[];
  connected: boolean;
  error: string | null;
}

type Action =
  | { type: "SNAPSHOT"; lendOrders: LendOrder[]; borrowOrders: BorrowOrder[] }
  | { type: "UPDATE"; newOrders: Order[]; updatedOrders: Order[] }
  | { type: "CONNECTED" }
  | { type: "DISCONNECTED" }
  | { type: "ERROR"; error: string };

function applyUpdate<T extends { orderId: string }>(
  existing: T[],
  newOrders: T[],
  updated: T[]
): T[] {
  const map = new Map(existing.map((o) => [o.orderId, o]));
  newOrders.forEach((o) => map.set(o.orderId, o));
  updated.forEach((o) => map.set(o.orderId, o));
  return Array.from(map.values());
}

function reducer(state: OrderBookState, action: Action): OrderBookState {
  switch (action.type) {
    case "CONNECTED":
      return { ...state, connected: true, error: null };
    case "DISCONNECTED":
      return { ...state, connected: false };
    case "ERROR":
      return { ...state, error: action.error, connected: false };
    case "SNAPSHOT":
      return {
        ...state,
        lendOrders: action.lendOrders,
        borrowOrders: action.borrowOrders,
      };
    case "UPDATE": {
      const newLend = action.newOrders.filter((o) => o.orderType === "lend") as LendOrder[];
      const newBorrow = action.newOrders.filter((o) => o.orderType === "borrow") as BorrowOrder[];
      const updLend = action.updatedOrders.filter((o) => o.orderType === "lend") as LendOrder[];
      const updBorrow = action.updatedOrders.filter((o) => o.orderType === "borrow") as BorrowOrder[];
      return {
        ...state,
        lendOrders: applyUpdate(state.lendOrders, newLend, updLend),
        borrowOrders: applyUpdate(state.borrowOrders, newBorrow, updBorrow),
      };
    }
    default:
      return state;
  }
}

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:3001/ws/orderbook";

export function useOrderBook() {
  const [state, dispatch] = useReducer(reducer, {
    lendOrders: [],
    borrowOrders: [],
    connected: false,
    error: null,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let dead = false;

    function connect() {
      if (dead) return;
      try {
        const ws = new WebSocket(WS_URL);
        wsRef.current = ws;

        ws.onopen = () => dispatch({ type: "CONNECTED" });

        ws.onmessage = (evt) => {
          try {
            const msg = JSON.parse(evt.data as string) as WsMessage;
            if (msg.type === "snapshot") {
              dispatch({
                type: "SNAPSHOT",
                lendOrders: msg.data.lendOrders,
                borrowOrders: msg.data.borrowOrders,
              });
            } else if (msg.type === "update") {
              dispatch({
                type: "UPDATE",
                newOrders: msg.data.newOrders,
                updatedOrders: msg.data.updatedOrders,
              });
            }
          } catch {
            // ignore parse errors
          }
        };

        ws.onerror = () => {
          dispatch({ type: "ERROR", error: "WebSocket connection failed" });
        };

        ws.onclose = () => {
          dispatch({ type: "DISCONNECTED" });
          if (!dead) {
            reconnectTimeout.current = setTimeout(connect, 3000);
          }
        };
      } catch {
        dispatch({ type: "ERROR", error: "Could not connect to backend" });
        if (!dead) {
          reconnectTimeout.current = setTimeout(connect, 5000);
        }
      }
    }

    connect();

    return () => {
      dead = true;
      if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current);
      wsRef.current?.close();
    };
  }, []);

  return state;
}
