import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { DialogHost } from './components/Dialog.tsx';
import { Layout } from './components/Layout.tsx';
import { getToken, onUnauthorized } from './lib/api.ts';
import { browserLocale, prefs } from './lib/i18n.ts';
import { ExerciseDetail } from './pages/ExerciseDetail.tsx';
import { ExerciseEditor } from './pages/ExerciseEditor.tsx';
import { Folder } from './pages/Folder.tsx';
import { History } from './pages/History.tsx';
import { Home } from './pages/Home.tsx';
import { Library } from './pages/Library.tsx';
import { LiveSession } from './pages/LiveSession.tsx';
import { Login } from './pages/Login.tsx';
import { OneRepMax } from './pages/OneRepMax.tsx';
import { Plates } from './pages/Plates.tsx';
import { SessionDetail } from './pages/SessionDetail.tsx';
import { Settings } from './pages/Settings.tsx';
import { Welcome } from './pages/Welcome.tsx';
import { WorkoutEditor } from './pages/WorkoutEditor.tsx';
import { startSync } from './sync/engine.ts';
import { localizeExercises } from './db/exercises.ts';

export function App() {
  const [authed, setAuthed] = useState(() => getToken() !== null);
  const { locale } = prefs.use();

  useEffect(() => onUnauthorized(() => setAuthed(false)), []);

  // Sync runs for as long as the device is logged in; offline it just waits.
  useEffect(() => (authed ? startSync() : undefined), [authed]);

  useEffect(() => {
    document.documentElement.lang = locale ?? browserLocale();
    if (locale) void localizeExercises(locale);
  }, [locale]);

  // Language and units are chosen first, once per device.
  if (!locale) return <Welcome />;
  if (!authed) return <Login onLoggedIn={() => setAuthed(true)} />;

  return (
    // Drawn again in a new language: dates and numbers formatted outside React follow it too.
    <BrowserRouter key={locale}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="exercises" element={<Library />} />
          <Route path="exercises/new" element={<ExerciseEditor />} />
          <Route path="exercises/:id" element={<ExerciseDetail />} />
          <Route path="exercises/:id/edit" element={<ExerciseEditor />} />
          <Route path="folders/:id" element={<Folder />} />
          <Route path="workouts/:id" element={<WorkoutEditor key="view" />} />
          <Route path="workouts/:id/edit" element={<WorkoutEditor key="edit" editing />} />
          <Route path="session" element={<LiveSession />} />
          <Route path="history" element={<History />} />
          <Route path="history/:id" element={<SessionDetail />} />
          <Route path="plates" element={<Plates />} />
          <Route path="1rm" element={<OneRepMax />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <DialogHost />
    </BrowserRouter>
  );
}
