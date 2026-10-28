import { useNavigate } from 'react-router-dom';
import { ask } from '../components/Dialog.tsx';
import { getLive, startSession } from '../db/sessions.ts';
import { unlockAudio } from './feedback.ts';
import { t } from './i18n.ts';

// Starts a workout, or brings back the session already in progress (only one at a time).
export function useStartSession() {
  const navigate = useNavigate();
  return async (workoutId: string) => {
    unlockAudio();
    const live = await getLive();
    if (live && live.workoutId !== workoutId) {
      await ask({
        title: t('session.alreadyTitle'),
        message: t('session.alreadyMessage'),
        confirm: t('session.alreadyConfirm'),
        cancel: null,
      });
    } else if (!live) {
      await startSession(workoutId);
    }
    navigate('/session');
  };
}
