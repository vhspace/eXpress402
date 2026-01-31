import { describe, expect, it } from "vitest";
import { encodeCanonicalJson, hashPayload, normalizeHex, signPayload } from "../src/yellow/codec.js";

describe("yellow codec", () => {
  it("encodes canonical JSON with stable key order", () => {
    const encoder = new TextDecoder();
    const payload = { b: 2, a: 1 };
    const encoded = encodeCanonicalJson(payload);
    expect(encoder.decode(encoded)).toBe("{\"a\":1,\"b\":2}");
  });

  it("hashes payload to 32 bytes", () => {
    const hash = hashPayload({ ok: true });
    expect(hash).toBeInstanceOf(Uint8Array);
    expect(hash.length).toBe(32);
  });

  it("normalizes hex with or without 0x prefix", () => {
    const withPrefix = normalizeHex("0x0a0b");
    const withoutPrefix = normalizeHex("0a0b");
    expect(withPrefix).toEqual(withoutPrefix);
    expect([...withPrefix]).toEqual([10, 11]);
  });

  it("signs payload and returns 65-byte hex signature", async () => {
    const payload = { hello: "world" };
    const privateKey = "0x1".padEnd(66, "0");
    const signature = await signPayload(payload, privateKey);
    expect(signature.startsWith("0x")).toBe(true);
    expect(signature.length).toBe(132);
  });
});
