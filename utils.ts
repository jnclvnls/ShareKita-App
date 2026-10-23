export const uid = () => Math.random().toString(36).slice(2, 10);

export function formatBytes(n: number): string {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), u.length - 1);
  return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${u[i]}`;
}

export const formatSpeed = (bps: number) => `${formatBytes(bps)}/s`;

export const stripScheme = (uri: string) => decodeURI(uri.replace(/^file:\/\//, ''));

export const safeName = (n: string) => n.replace(/[^\w.\- ]+/g, '_');
