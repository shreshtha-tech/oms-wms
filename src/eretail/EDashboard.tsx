import Shell from './Shell';
import LiveOrderWorkspace from '../pages/LiveOrderWorkspace';

export default function EDashboard() {
  return (
    <Shell active="dashboard" breadcrumb="Dashboard" openScreens={[{ label: 'Dashboard', to: '#' }]}>
      <LiveOrderWorkspace title="D-Mills dashboard" dashboard />
    </Shell>
  );
}
