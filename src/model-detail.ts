export const TRAE_MODEL_DETAIL_PATH = '/api/ide/v1/batch_get_detail_param'

/**
 * TraeCode functions, in the IDE's own probe order.
 *
 * This list previously mixed TraeWork functions (`solo_agent_remote`,
 * `solo_work_remote`, `solo_agent_lite`, `solo_work_lite`, `solo_design_*`)
 * with TraeCode ones, which is how the TraeWork catalog leaked into this
 * plugin. Only TraeCode entries remain, so a `batch_get_detail_param` probe
 * cannot answer a TraeWork model set.
 */
export const TRAE_MODEL_DETAIL_FUNCTIONS = [
  'chat_v3', 'builder_v3', 'ui_builder_v2', 'builder', 'chat', 'inline_chat',
  'solo_coder', 'git_ai', 'custom_agent_generation', 'utils', 'code_reviewer',
  'code_review_summary', 'multimodal', 'system_diagnosis',
] as const

export interface TraeModelDetailRequest {
  functions: string[]
  agent_type: '' | 'solo_agent'
  current_config_info: { config_name: string; is_custom_model: boolean }
  mode_type: 0
  access_type: 0
  ab_force_vids: ''
  ab_autotest_advanced_mode: 0
}

/** Build the exact request shape observed in successful current Trae CN logs. */
export function buildTraeModelDetailRequest(configName = '', custom = false): TraeModelDetailRequest {
  return {
    functions: [...TRAE_MODEL_DETAIL_FUNCTIONS],
    // Current Trae 3.3.83 logs send an empty agent_type for the broad catalog
    // snapshot; older 3.3.79 custom-model lookups used solo_agent.
    agent_type: configName === '' ? '' : 'solo_agent',
    current_config_info: { config_name: configName, is_custom_model: custom },
    mode_type: 0,
    access_type: 0,
    ab_force_vids: '',
    ab_autotest_advanced_mode: 0,
  }
}
