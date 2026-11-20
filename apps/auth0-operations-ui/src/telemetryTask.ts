import type { PipelineConfig, RocketRideClient } from 'rocketride';

/** Reject unexpected components both before starting and after attaching. */
export function verifyTelemetryPipeline(value: unknown, projectId: string): void {
 const pipeline = value as PipelineConfig | undefined;
 const components = pipeline?.components;
 if (pipeline?.project_id !== projectId || !Array.isArray(components) || components.length !== 2) throw new Error('The telemetry task configuration could not be verified.');
 const source = components.find(c => c.id === 'tools_1');
 const auth = components.find(c => c.id === 'tool_auth0_1');
 const control = auth?.control;
 if (source?.provider !== 'tools' || auth?.provider !== 'tool_auth0' || auth.config?.allowWrite !== false || source.control?.length || components.some(c => c.input?.length) || !Array.isArray(control) || control.length !== 1 || control[0].classType !== 'tool' || control[0].from !== 'tools_1') throw new Error('The telemetry task configuration could not be verified.');
}

/** Every refresh reattaches or replaces an expired telemetry task, never an AI task. */
export async function startTelemetryTask(client: Pick<RocketRideClient, 'use' | 'getTaskPipeline'>, pipeline: PipelineConfig): Promise<string> {
 const projectId = pipeline.project_id;
 if (!projectId) throw new Error('The telemetry task configuration could not be verified.');
 verifyTelemetryPipeline(pipeline, projectId);
 const task = await client.use({pipeline, ttl: 900, useExisting: true, pipelineTraceLevel: 'metadata'});
 verifyTelemetryPipeline(await client.getTaskPipeline(task.token), projectId);
 return task.token;
}
