import { executeLocalJob } from '../src/localJob';
import { Job } from '../src/types';

const job: Job = {
  deliveryId: 'test-job-' + Date.now(),
  eventType: 'workflow_job',
  githubJobId: '123',
  githubRepo: 'redwoodjs/opposite-actions',
  githubToken: 'mock_token',
  headSha: 'd6a273329b89417a27ba85bfc5004b6aadff0c13',
  env: {
    TEST_VAR: 'Hello form test script',
  },
  repository: {
    name: 'opposite-actions',
    owner: { login: 'redwoodjs' }
  }
};

executeLocalJob(job).catch(console.error);
