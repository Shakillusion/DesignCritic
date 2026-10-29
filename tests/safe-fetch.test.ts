import { describe, expect, it } from "vitest";
import { assertPublicUrl, isPrivateAddress, safeFetch, SafeFetchError } from "@/lib/net/safe-fetch";

describe("isPrivateAddress", () => {
  it.each([
    "0.0.0.0", "0.1.2.3", "10.0.0.1", "10.255.255.255", "100.64.0.1", "100.127.255.254", "127.0.0.1", "127.1.2.3",
    "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.0.0.8", "192.168.1.1", "198.18.0.1", "198.19.255.255",
    "224.0.0.1", "239.255.255.250", "240.0.0.1", "255.255.255.255",
    "::", "::1", "0:0:0:0:0:0:0:1", "fc00::1", "fd12:3456::1", "fe80::1", "fe80::1%eth0", "febf::1", "ff02::1",
    "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "64:ff9b::10.0.0.1", "64:ff9b::c0a8:101",
    "[::1]", "not-an-ip", "", "1.2.3", "999.1.1.1",
  ])("%s is private/invalid", (ip) => expect(isPrivateAddress(ip)).toBe(true));

  it.each([
    "1.1.1.1", "8.8.8.8", "100.63.255.255", "100.128.0.1", "172.15.255.255", "172.32.0.1", "192.0.1.1", "192.169.0.1",
    "198.17.0.1", "198.20.0.1", "223.255.255.255", "151.101.1.69",
    "2606:4700:4700::1111", "2001:4860:4860::8888", "::ffff:8.8.8.8", "64:ff9b::8.8.8.8", "fec0::1",
  ])("%s is public", (ip) => expect(isPrivateAddress(ip)).toBe(false));
});

describe("assertPublicUrl", () => {
  it.each([
    "http://localhost",
    "http://localhost:3000/x",
    "http://foo.localhost/",
    "http://printer.local/",
    "http://metadata.google.internal/",
    "http://127.0.0.1",
    "http://2130706433/", // decimal 127.0.0.1
    "http://0x7f.1/",
    "http://[::1]",
    "http://[::ffff:127.0.0.1]/",
    "http://10.1.2.3/",
    "file:///etc/passwd",
    "ftp://example.com/",
    "javascript:alert(1)",
    "http://user:pw@x.com",
    "http://user@x.com",
    "http://169.254.169.254/latest/meta-data",
    "http://example.com:22/",
    "not a url",
  ])("rejects %s", (url) => {
    expect(() => assertPublicUrl(url)).toThrow(SafeFetchError);
    try {
      assertPublicUrl(url);
    } catch (e) {
      expect((e as SafeFetchError).code).toBe("blocked-url");
    }
  });

  it.each([
    "https://api.openverse.org/v1/images/?q=alps",
    "https://commons.wikimedia.org/w/api.php?action=query",
    "http://example.com:8080/a.png",
    "https://8.8.8.8/",
  ])("accepts %s", (url) => expect(assertPublicUrl(url)).toBeInstanceOf(URL));
});

describe("safeFetch", () => {
  it("rejects blocked URLs before any network activity", async () => {
    await expect(safeFetch("http://127.0.0.1:8080/")).rejects.toMatchObject({ code: "blocked-url" });
    await expect(safeFetch("http://169.254.169.254/latest/meta-data")).rejects.toMatchObject({ code: "blocked-url" });
  });
});
