/**
 * Official remote MCP servers DEA knows by name, for `dea hub connect <app>`. Every URL was checked on 2026-11-03:
 * it answered an MCP initialize with 401 + OAuth protected-resource metadata (or served openly), and `dcr` says
 * whether its authorization server offers dynamic client registration (DEA registers itself, no setup).
 * Apps without it need your own free OAuth app: `dea hub connect <app> --client-id <id>`, or a token header.
 * All of these are run by the app's own company; DEA adds no paid service in between.
 */
export interface CatalogEntry {
  name: string;
  title: string;
  url: string;
  dcr: boolean;
  /** no login at all */
  open?: boolean;
  note?: string;
}

export const CATALOG: CatalogEntry[] = [
  { name: 'notion', title: 'Notion', url: 'https://mcp.notion.com/mcp', dcr: true },
  { name: 'linear', title: 'Linear', url: 'https://mcp.linear.app/mcp', dcr: true },
  { name: 'vercel', title: 'Vercel', url: 'https://mcp.vercel.com', dcr: true },
  { name: 'sentry', title: 'Sentry', url: 'https://mcp.sentry.dev/mcp', dcr: true },
  { name: 'atlassian', title: 'Atlassian (Jira, Confluence)', url: 'https://mcp.atlassian.com/v1/mcp', dcr: true },
  { name: 'canva', title: 'Canva', url: 'https://mcp.canva.com/mcp', dcr: true },
  { name: 'stripe', title: 'Stripe', url: 'https://mcp.stripe.com', dcr: true },
  { name: 'supabase', title: 'Supabase', url: 'https://mcp.supabase.com/mcp', dcr: true },
  { name: 'neon', title: 'Neon', url: 'https://mcp.neon.tech/mcp', dcr: true },
  { name: 'cloudflare', title: 'Cloudflare (Workers bindings)', url: 'https://bindings.mcp.cloudflare.com/mcp', dcr: true },
  { name: 'webflow', title: 'Webflow', url: 'https://mcp.webflow.com/mcp', dcr: true },
  { name: 'wix', title: 'Wix', url: 'https://mcp.wix.com/mcp', dcr: true },
  { name: 'paypal', title: 'PayPal', url: 'https://mcp.paypal.com/mcp', dcr: true },
  { name: 'intercom', title: 'Intercom', url: 'https://mcp.intercom.com/mcp', dcr: true },
  { name: 'monday', title: 'monday.com', url: 'https://mcp.monday.com/mcp', dcr: true },
  { name: 'clickup', title: 'ClickUp', url: 'https://mcp.clickup.com/mcp', dcr: true },
  { name: 'airtable', title: 'Airtable', url: 'https://mcp.airtable.com/mcp', dcr: true },
  { name: 'todoist', title: 'Todoist', url: 'https://ai.todoist.net/mcp', dcr: true },
  { name: 'miro', title: 'Miro', url: 'https://mcp.miro.com/', dcr: true },
  { name: 'gitlab', title: 'GitLab', url: 'https://gitlab.com/api/v4/mcp', dcr: true },
  {
    name: 'zapier',
    title: 'Zapier',
    url: 'https://mcp.zapier.com/api/mcp/mcp',
    dcr: true,
    note: 'Zapier itself has paid plans; its MCP works on the free plan within its limits.',
  },
  { name: 'jam', title: 'Jam', url: 'https://mcp.jam.dev/mcp', dcr: true },
  {
    name: 'huggingface',
    title: 'Hugging Face',
    url: 'https://huggingface.co/mcp',
    dcr: true,
    open: true,
    note: 'Works without login; log in for your own spaces.',
  },
  { name: 'context7', title: 'Context7 (library docs)', url: 'https://mcp.context7.com/mcp', dcr: true, open: true },
  { name: 'deepwiki', title: 'DeepWiki (GitHub repo docs)', url: 'https://mcp.deepwiki.com/mcp', dcr: false, open: true },
  { name: 'cloudflare-docs', title: 'Cloudflare docs', url: 'https://docs.mcp.cloudflare.com/mcp', dcr: false, open: true },
  {
    name: 'github',
    title: 'GitHub',
    url: 'https://api.githubcopilot.com/mcp/',
    dcr: false,
    note: 'No dynamic registration. Use a fine-grained personal access token: dea hub connect github --token-env GITHUB_TOKEN (or --client-id of your own GitHub OAuth app).',
  },
  {
    name: 'figma',
    title: 'Figma',
    url: 'https://mcp.figma.com/mcp',
    dcr: false,
    note: 'Figma advertises registration but refuses unknown clients (HTTP 403, checked 2026-11-03). Use the Figma desktop app’s own MCP server instead: dea hub add figma-desktop http://127.0.0.1:3845/mcp',
  },
  {
    name: 'slack',
    title: 'Slack',
    url: 'https://mcp.slack.com/mcp',
    dcr: false,
    note: 'Needs a Slack app of your own (client id) approved in your workspace.',
  },
  { name: 'asana', title: 'Asana', url: 'https://mcp.asana.com/v2/mcp', dcr: false, note: 'Needs your own Asana OAuth app: --client-id.' },
  { name: 'hubspot', title: 'HubSpot', url: 'https://mcp.hubspot.com', dcr: false, note: 'Needs your own HubSpot app: --client-id.' },
  { name: 'box', title: 'Box', url: 'https://mcp.box.com', dcr: false, note: 'Needs your own Box app: --client-id.' },
];

export function findCatalog(name: string): CatalogEntry | undefined {
  return CATALOG.find((c) => c.name === name.toLowerCase());
}
