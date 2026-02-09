import { executeJob } from '../src/executor';
import { Job } from '../src/types';

const job: Job = {
  deliveryId: 'test-job-' + Date.now(),
  eventType: 'workflow_job',
  env: {
    TEST_VAR: 'Hello form test script',
    SECRET_VAR: 'TOP_SECRET_VALUE'
  },
  repository: {
    name: 'test-repo',
    owner: { login: 'test-user' }
  }
};

executeJob(job).catch(console.error);
