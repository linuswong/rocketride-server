import type { PipelineConfig, RocketRideClient } from 'rocketride';

export class TelemetryTaskMismatchError extends Error {
 constructor() { super('The running telemetry task uses different Auth0 connection settings.'); }
}

export class TelemetryTaskTimeoutError extends Error {
 constructor(stage: 'start' | 'verify') {
  super(stage === 'start'
   ? 'Starting the Auth0 task timed out. It may still be starting; check RocketRide before trying again.'
   : 'Verifying the Auth0 task timed out. The task may still be running; check RocketRide before trying again.');
 }
}

async function bounded<T>(request: Promise<T>, milliseconds: number, stage: 'start' | 'verify'): Promise<T> {
 let timer: ReturnType<typeof setTimeout> | undefined;
 try {
  return await Promise.race([request,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new TelemetryTaskTimeoutError(stage)),milliseconds);})]);
 } finally { if (timer) clearTimeout(timer); }
}

/** Give each app session its own task identity while reusing it within that session. */
export function createSessionTelemetryPipeline(pipeline: PipelineConfig): PipelineConfig {
 return {...pipeline, project_id:crypto.randomUUID()};
}

/** Reject unexpected components both before starting and after attaching. */
export function verifyTelemetryPipeline(value: unknown, projectId: string, expected?: PipelineConfig): void {
 const pipeline = value as PipelineConfig | undefined;
 const components = pipeline?.components;
 if (pipeline?.project_id !== projectId || !Array.isArray(components) || components.length !== 2) throw new Error('The telemetry task configuration could not be verified.');
 const source = components.find(c => c.id === 'tools_1');
 const auth = components.find(c => c.id === 'tool_auth0_1');
 const control = auth?.control;
 if (source?.provider !== 'tools' || auth?.provider !== 'tool_auth0' || auth.config?.allowWrite !== false || source.control?.length || components.some(c => c.input?.length) || !Array.isArray(control) || control.length !== 1 || control[0].classType !== 'tool' || control[0].from !== 'tools_1') throw new Error('The telemetry task configuration could not be verified.');
 if (expected) {
  const wanted = expected.components?.find(c => c.id === 'tool_auth0_1')?.config;
  const keys = ['domain','clientId','clientSecret','writeClientId','writeClientSecret'] as const;
  if (!wanted || keys.some(key => auth.config?.[key] !== wanted[key])) throw new TelemetryTaskMismatchError();
 }
}

/** Every refresh reattaches or replaces an expired telemetry task, never an AI task. */
export async function startTelemetryTask(client: Pick<RocketRideClient, 'use' | 'getTaskPipeline'>, pipeline: PipelineConfig, limits = {startMs:30000,verifyMs:15000}): Promise<string> {
 const projectId = pipeline.project_id;
 if (!projectId) throw new Error('The telemetry task configuration could not be verified.');
 verifyTelemetryPipeline(pipeline, projectId);
 const task = await bounded(client.use({pipeline, ttl: 900, useExisting: true, pipelineTraceLevel: 'metadata'}),limits.startMs,'start');
 verifyTelemetryPipeline(await bounded(client.getTaskPipeline(task.token),limits.verifyMs,'verify'), projectId, pipeline);
 return task.token;
}
