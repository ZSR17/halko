import { createStore } from '../lib/store.ts';
import { Sheet } from './Sheet.tsx';
import { t } from '../lib/i18n.ts';

interface Question {
  title: string;
  // Optional: the title alone can be enough.
  message?: string;
  // Label of the main button.
  confirm: string;
  // Red main button, for what cannot be undone.
  danger?: boolean;
  // Label of the second button; null for a plain message with a single button.
  cancel?: string | null;
}

const pending = createStore<{ question: (Question & { answer: (ok: boolean) => void }) | null }>({ question: null });

// In-app replacement for confirm() and alert(): resolves with true when the main button is chosen.
export function ask(question: Question): Promise<boolean> {
  return new Promise((answer) => pending.set({ question: { ...question, answer } }));
}

// Shows the current question; mounted once in the app.
export function DialogHost() {
  const { question } = pending.use();
  if (!question) return null;
  const close = (ok: boolean) => {
    pending.set({ question: null });
    question.answer(ok);
  };
  return (
    <Sheet title={question.title} onClose={() => close(false)}>
      {question.message && <p style={{ margin: 0, lineHeight: 1.5 }}>{question.message}</p>}
      <button type="button" className={`btn ${question.danger ? 'btn-danger-solid' : 'btn-primary'}`} onClick={() => close(true)}>
        {question.confirm}
      </button>
      {question.cancel !== null && (
        <button type="button" className="btn" onClick={() => close(false)}>
          {question.cancel ?? t('common.cancel')}
        </button>
      )}
    </Sheet>
  );
}
