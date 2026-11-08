import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chinaMarketScan,
  cnQuoteSymbol,
  dropChinaBShares,
  dropHkRmbCounters,
  europeMarketScan,
  hkQuoteSymbol,
  hongKongMarketScan,
} from "./tradingview.js";

function rowsFor(url: string): unknown[] {
  if (url.includes("/uk/scan")) {
    return [{ s: "LSE:HSBA", d: ["HSBC Holdings Plc", 850, 1.2, 300_000_000_000, "Finance", 1000, "GBP"] }];
  }
  if (url.includes("/germany/scan")) {
    return [{ s: "XETR:SAP", d: ["SAP SE", 183, -2.5, 213_000_000_000, "Technology Services", 700, "EUR"] }];
  }
  if (url.includes("/switzerland/scan")) {
    // Switzerland's response is broken this run — the merge must still return the other markets' rows.
    return null as unknown as unknown[];
  }
  return [];
}

function mockFetch() {
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    const rows = rowsFor(url);
    if (rows === null) return Promise.resolve({ ok: false, status: 502 });
    return Promise.resolve({ ok: true, json: async () => ({ data: rows }) });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("HK and China listing cleanup", () => {
  it("drops an RMB dual counter when the HKD listing of the same name is present", () => {
    const rows = dropHkRmbCounters([
      { symbol: "80700", name: "Tencent Holdings Ltd" },
      { symbol: "700", name: "Tencent Holdings Ltd" },
      { symbol: "80001", name: "Only Listed As Eight" },
    ]);
    expect(rows.map((r) => r.symbol)).toEqual(["700", "80001"]);
  });

  it("pads short HK codes and maps Shanghai and Shenzhen suffixes", () => {
    expect(hkQuoteSymbol("700")).toBe("0700.HK");
    expect(hkQuoteSymbol("5")).toBe("0005.HK");
    expect(hkQuoteSymbol("9988")).toBe("9988.HK");
    expect(cnQuoteSymbol("600519", "SSE")).toBe("600519.SS");
    expect(cnQuoteSymbol("300750", "SZSE")).toBe("300750.SZ");
  });

  it("drops Shanghai and Shenzhen B-shares", () => {
    const rows = dropChinaBShares([
      { symbol: "600519", exchange: "SSE" },
      { symbol: "900901", exchange: "SSE" },
      { symbol: "000858", exchange: "SZSE" },
      { symbol: "200002", exchange: "SZSE" },
    ]);
    expect(rows.map((r) => r.symbol)).toEqual(["600519", "000858"]);
  });
});

describe("hongKongMarketScan and chinaMarketScan", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("scans the hongkong region once and rewrites the HKD counter to a Yahoo symbol", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const data = String(url).includes("/hongkong/scan")
        ? [
            { s: "HKEX:80700", d: ["Tencent Holdings Ltd", 355, -2.7, 3.6e12, "Technology Services", 100, "HKEX"] },
            { s: "HKEX:700", d: ["Tencent Holdings Ltd", 420, -2.4, 3.6e12, "Technology Services", 100, "HKEX"] },
          ]
        : [];
      return Promise.resolve({ ok: true, json: async () => ({ data }) });
    });
    vi.stubGlobal("fetch", fetchMock);

    const rows = await hongKongMarketScan();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/hongkong/scan");
    expect(rows.map((r) => r.symbol)).toEqual(["0700.HK"]);
  });

  it("scans the china region once and suffixes Shanghai and Shenzhen listings", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        const data = String(url).includes("/china/scan")
          ? [
              { s: "SSE:600519", d: ["Kweichow Moutai Co., Ltd. Class A", 1400, 1, 2e12, "Consumer Non-Durables", 10, "SSE"] },
              { s: "SZSE:300750", d: ["Contemporary Amperex Technology Co., Limited Class A", 200, -1, 1e12, "Producer Manufacturing", 10, "SZSE"] },
              { s: "SSE:900901", d: ["B Share", 1, 0, 1e9, "Finance", 1, "SSE"] },
            ]
          : [];
        return Promise.resolve({ ok: true, json: async () => ({ data }) });
      })
    );

    const rows = await chinaMarketScan();
    expect(rows.map((r) => r.symbol)).toEqual(["600519.SS", "300750.SZ"]);
  });
});

describe("europeMarketScan", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("queries every configured European market and merges the results", async () => {
    const fetchMock = mockFetch();
    const rows = await europeMarketScan();

    // One POST per market in EUROPE_MARKETS (uk, germany, france, netherlands,
    // switzerland, italy, spain, sweden, belgium) — no combined region exists.
    expect(fetchMock.mock.calls.length).toBe(9);
    expect(rows.map((r) => r.symbol).sort()).toEqual(["HSBA", "SAP"]);
  });

  it("sorts merged rows by market cap descending, largest first regardless of source market", async () => {
    mockFetch();
    const rows = await europeMarketScan();
    expect(rows[0].symbol).toBe("HSBA"); // 300B > SAP's 213B
    expect(rows[1].symbol).toBe("SAP");
  });

  it("tags each row with its country and fundamental currency for later FX normalization", async () => {
    mockFetch();
    const rows = await europeMarketScan();
    const sap = rows.find((r) => r.symbol === "SAP");
    expect(sap).toMatchObject({ country: "Germany", currency: "EUR", exchange: "XETR" });
  });

  it("keeps the rows from healthy markets when one market's request fails", async () => {
    mockFetch();
    const rows = await europeMarketScan();
    // Switzerland's fetch resolves ok:false above — europeMarketScan must not
    // reject the whole scan because of it (Promise.allSettled).
    expect(rows.length).toBe(2);
  });
});
