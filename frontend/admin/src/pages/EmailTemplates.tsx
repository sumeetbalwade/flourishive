import { EmailTemplates as Editor, useToast } from '@flourishive/ui';
import { useApi } from '../lib/api.tsx';
import { messageOf } from '../lib/errors.ts';
import { Layout } from './Layout.tsx';

/** The platform's wording for every email, and which ones companies may change (D-59). */
export function EmailTemplates() {
  const api = useApi();
  const toast = useToast();
  const t = api.mail.templates;
  const wrap = async <T,>(p: Promise<T>): Promise<T> => {
    try {
      return await p;
    } catch (e) {
      throw new Error(messageOf(e));
    }
  };
  return (
    <Layout active="email-templates" title="Email wording">
      <Editor
        canLock
        api={{
          list: () => wrap(t.list()),
          get: (e) => wrap(t.get(e)),
          save: (e, b) => wrap(t.save(e, b)),
          reset: (e) => wrap(t.reset(e)),
          preview: (e, b) => wrap(t.preview(e, b)),
          test: (e, b) => wrap(t.test(e, b)),
        }}
        onError={(description) =>
          toast({ title: 'Could not do that', description, tone: 'danger' })
        }
        onNotice={(title) => toast({ title, tone: 'success' })}
      />
    </Layout>
  );
}
