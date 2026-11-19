import {
  Button,
  Card,
  CardTitle,
  Field,
  Input,
  Select,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useToast,
} from '@flourishive/ui';
import { useState } from 'react';
import { Layout } from './Layout.tsx';

const FIELDS = [
  '{{person.name}}',
  '{{person.designation}}',
  '{{engagement.start_date}}',
  '{{entity.name}}',
  '{{letter.ref}}',
];

export function Templates() {
  const toast = useToast();
  const [body, setBody] = useState(
    'Dear {{person.name}},\n\nWe are pleased to offer you the role of {{person.designation}} at {{entity.name}}, starting {{engagement.start_date}}.',
  );
  const [kind, setKind] = useState('visual');
  return (
    <Layout
      active="templates"
      title="Template editor"
      actions={
        <Button
          size="sm"
          onClick={() =>
            toast({ tone: 'success', title: 'Template saved', description: 'Offer letter v4' })
          }
        >
          Save
        </Button>
      }
    >
      <Tabs defaultValue="edit">
        <TabsList>
          <TabsTrigger value="edit">Edit</TabsTrigger>
          <TabsTrigger value="preview">Preview</TabsTrigger>
        </TabsList>
        <div className="mt-5 grid gap-6 xl:grid-cols-[300px_1fr]">
          <Card className="grid content-start gap-4">
            <CardTitle>Source</CardTitle>
            <Field label="Template type" htmlFor="kind">
              <Select
                id="kind"
                value={kind}
                onValueChange={setKind}
                options={[
                  { value: 'visual', label: 'Visual editor' },
                  { value: 'pdf', label: 'Uploaded PDF / fillable PDF' },
                  { value: 'docx', label: 'Word (.docx) template' },
                ]}
              />
            </Field>
            <Field label="Name" htmlFor="tname">
              <Input id="tname" defaultValue="Offer letter" />
            </Field>
            <div>
              <div className="mb-2 text-[13px] font-medium text-muted">Insert field</div>
              <div className="flex flex-wrap gap-2">
                {FIELDS.map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setBody((b) => b + ' ' + f)}
                    className="rounded-pill bg-accent-lo px-3 py-1 font-mono text-xs text-accent-hi hover:bg-accent hover:text-on-accent"
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>
          </Card>
          <div>
            <TabsContent value="edit">
              <Card>
                <textarea
                  aria-label="Letter body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={14}
                  className="w-full resize-y rounded-md border border-line-strong bg-surface-2 p-4 font-mono text-sm text-fg"
                />
              </Card>
            </TabsContent>
            <TabsContent value="preview">
              <div className="mx-auto aspect-[1/1.414] max-w-[520px] whitespace-pre-wrap rounded-sm bg-[#f6f2ea] p-10 text-[13px] leading-relaxed text-[#2a241e] shadow-card">
                <div className="mb-6 font-display text-2xl">Flourisense Technologies LLP</div>
                {body
                  .replace('{{person.name}}', 'Riya Patil')
                  .replace('{{person.designation}}', 'Software Intern')
                  .replace('{{entity.name}}', 'Flourisense')
                  .replace('{{engagement.start_date}}', '1 Dec 2026')}
              </div>
            </TabsContent>
          </div>
        </div>
      </Tabs>
    </Layout>
  );
}
