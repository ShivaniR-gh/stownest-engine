import { useNavigate } from 'react-router-dom';
import { Button, EmptyState } from '@/components/primitives';
import { TopBar } from '@/components/shell/TopBar';

export function Forbidden() {
  const nav = useNavigate();
  return (
    <>
      <TopBar title="Not permitted" />
      <div className="page">
        <div className="card">
          <EmptyState icon="shield" title="You do not have access to this area"
            body="Your account is not assigned to this department. A super admin can add it on the access control sheet under Administration → Users."
            action={<Button size="sm" onClick={() => nav('/')}>Back to Overview</Button>} />
        </div>
      </div>
    </>
  );
}

export function NotFound() {
  const nav = useNavigate();
  return (
    <>
      <TopBar title="Not found" />
      <div className="page">
        <div className="card">
          <EmptyState icon="search" title="That page does not exist"
            body="The link may be out of date, or the department may have been removed from the configuration."
            action={<Button size="sm" onClick={() => nav('/')}>Back to Overview</Button>} />
        </div>
      </div>
    </>
  );
}
