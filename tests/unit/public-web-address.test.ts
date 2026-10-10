import { describe, expect, it } from 'vitest';
import { isPublicWebIp, publicWebAddress } from '../../src/main/public-web-address';

describe('公开网页地址边界', () => {
  it('保留查询、规范化主机并移除不参与请求的片段', () => {
    expect(publicWebAddress('https://ARTICLE.example.com:443/a?q=1#section')).toEqual({ url: 'https://article.example.com/a?q=1', hostname: 'article.example.com' });
    expect(publicWebAddress('https://article.example.com./')).toEqual({ url: 'https://article.example.com/', hostname: 'article.example.com' });
  });
  it.each(['invalid-url', 'http://example.com', 'file:///secret', 'https://a:b@example.com', 'https://example.com:444', 'https://localhost', 'https://foo.local.', 'https://a.internal', 'https://a.lan', 'https://host.home.arpa', 'https://single', 'https://a.invalid', 'https://bad_host.com', 'https://example.com/\nsecret', 'https://127.1', 'https://0x7f000001', 'https://2130706433', 'https://[::ffff:127.0.0.1]', `https://example.com/${'a'.repeat(2048)}`])('拒绝危险或非法目标 %s', url => {
    expect(() => publicWebAddress(url)).toThrow(/网页地址/);
  });
  it.each(['0.0.0.0', '10.0.0.1', '127.0.0.1', '169.254.169.254', '172.31.0.1', '192.168.1.1', '100.64.0.1', '192.0.0.170', '192.0.2.1', '192.88.99.1', '198.18.0.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '255.255.255.255', '::1', '::ffff:8.8.8.8', 'fc00::1', 'fe80::1', '2001::1', '2001:2::1', '2001:10::1', '2001:20::1', '2001:db8::1', '2002:7f00:1::1', '3ffe::1', '3fff::1', 'not-an-ip'])('拒绝非公开IP %s', address => {
    expect(isPublicWebIp(address)).toBe(false);
  });
  it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111', '2001:4860:4860::8888'])('DNS接受公开IP而网页入口拒绝字面量 %s', address => {
    expect(isPublicWebIp(address)).toBe(true);
    expect(() => publicWebAddress(`https://${address.includes(':') ? `[${address}]` : address}/`)).toThrow(/网页地址/);
  });
});
