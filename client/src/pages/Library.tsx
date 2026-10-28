import { Link } from 'react-router-dom';
import { ExerciseList } from '../components/ExerciseList.tsx';
import { Icon } from '../components/Icon.tsx';
import { t } from '../lib/i18n.ts';

export function Library() {
  return (
    <div className="page">
      <ExerciseList
        header={
          <header className="row between">
            <h1 className="title">{t('library.title')}</h1>
            <Link to="/exercises/new" className="btn btn-ghost">
              <Icon name="plus" size={18} />
              {t('library.create')}
            </Link>
          </header>
        }
      />
    </div>
  );
}
