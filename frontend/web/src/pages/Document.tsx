import { Badge, Button, Card, CardTitle, SigningAnimation } from '@flourishive/ui';
import { ArrowLeft, Download } from 'lucide-react';
import { LETTERS, STATUS, TIMELINE } from '../mock.ts';
import { go } from '../router.ts';
import { Layout } from './Layout.tsx';

export function Document({ id }: { id: string }) {
  const l = LETTERS.find((x) => x.id === id) ?? LETTERS[0]!;
  return (
    <Layout
      active="letters"
      title={l.type}
      actions={
        <Button size="sm" variant="secondary">
          <Download size={14} /> Download PDF
        </Button>
      }
    >
      <button
        type="button"
        onClick={() => go('/app/letters')}
        className="mb-4 inline-flex items-center gap-2 text-sm text-muted hover:text-fg"
      >
        <ArrowLeft size={14} /> All letters
      </button>
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <Card className="p-0">
          <div className="mx-auto my-8 aspect-[1/1.414] w-full max-w-[520px] rounded-sm bg-[#f6f2ea] p-10 text-[#2a241e] shadow-card">
            <div className="font-display text-2xl">Flourisense Technologies LLP</div>
            <div className="mt-1 font-mono text-[10px] text-[#7d7164]">{l.ref}</div>
            <p className="mt-8 text-[13px] leading-relaxed">
              Dear {l.person.split(' ')[0]},
              <br />
              <br />
              We are pleased to confirm your {l.type.toLowerCase()} as {l.role.toLowerCase()},
              effective 1 December 2026. The terms are set out below…
            </p>
            <div className="mt-24 border-t border-[#cbbfab] pt-2 text-[11px] text-[#7d7164]">
              Digitally signed by Noah Brooks, HR Lead
              <br />
              Reason: Issued on behalf of Flourisense · RFC 3161 timestamp
            </div>
          </div>
        </Card>
        <div className="grid content-start gap-6">
          <Card>
            <div className="flex items-center gap-4">
              <SigningAnimation
                state={
                  l.status === 'failed'
                    ? 'failed'
                    : l.status === 'accepted' || l.status === 'signed'
                      ? 'done'
                      : 'waiting'
                }
                size={72}
              />
              <div>
                <CardTitle>{l.person}</CardTitle>
                <Badge tone={STATUS[l.status].tone} className="mt-1">
                  {STATUS[l.status].label}
                </Badge>
              </div>
            </div>
          </Card>
          <Card>
            <CardTitle>Signature timeline</CardTitle>
            <ol className="mt-4 grid gap-5">
              {TIMELINE.map((e, i) => (
                <li key={i} className="relative pl-7">
                  <span
                    className={`absolute left-0 top-1 h-3.5 w-3.5 rounded-pill border-2 ${e.done ? 'border-success bg-success' : 'border-line-strong'}`}
                  />
                  {i < TIMELINE.length - 1 ? (
                    <span className="absolute left-[6px] top-5 h-[calc(100%+4px)] w-px bg-line" />
                  ) : null}
                  <div className="text-sm">{e.what}</div>
                  <div className="mt-0.5 font-mono text-xs text-faint">
                    {e.t} · {e.who}
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </Layout>
  );
}
