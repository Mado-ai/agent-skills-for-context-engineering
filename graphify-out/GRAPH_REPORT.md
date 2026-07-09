# Graph Report - /home/user/agent-skills-for-context-engineering  (2026-07-09)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 1017 nodes · 1602 edges · 52 communities (48 shown, 4 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 82 edges (avg confidence: 0.65)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `b9a4c9da`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- datetime
- description_generator.py
- Any
- index.ts
- compaction.py
- pipeline_template.py
- CompressionEvaluator
- ScratchPadManager
- context_manager.py
- .analyze
- SkillGenerator
- ReasoningTrace
- loop.py
- OptimizationLoop
- TraceAnalyzer
- PromptOptimizer
- package.json
- compilerOptions
- Sandbox
- WarmPoolManager
- ImageBuilder
- Any
- test_models.py
- package.json
- pipeline_example.py
- scripts
- _demo
- weekly_review.py
- AgentFailureHandler
- content_ideas.py
- idea_to_draft.py
- StructuredSummarizer
- AgentSession
- devDependencies
- AgentMessage
- stale_contacts.py
- evaluation_example.py
- AgentCommunication
- sandbox_manager.py
- ConsensusManager
- HandoffProtocol
- 02_tool_usage.py
- dependencies
- coordination.py
- repository
- install.sh
- __init__.py
- engines
- reasoning-trace-optimizer

## God Nodes (most connected - your core abstractions)
1. `ReasoningTrace` - 26 edges
2. `OptimizationLoop` - 22 edges
3. `TraceAnalyzer` - 21 edges
4. `AnalysisResult` - 20 edges
5. `compilerOptions` - 20 edges
6. `SkillGenerator` - 18 edges
7. `TraceCapture` - 17 edges
8. `PromptOptimizer` - 17 edges
9. `LoopResult` - 16 edges
10. `scripts` - 15 edges

## Surprising Connections (you probably didn't know these)
- `main()` --calls--> `TraceCapture`  [INFERRED]
  examples/interleaved-thinking/examples/01_basic_capture.py → examples/interleaved-thinking/reasoning_trace_optimizer/capture.py
- `main()` --calls--> `TraceCapture`  [INFERRED]
  examples/interleaved-thinking/examples/02_tool_usage.py → examples/interleaved-thinking/reasoning_trace_optimizer/capture.py
- `main()` --calls--> `SkillGenerator`  [INFERRED]
  examples/interleaved-thinking/examples/03_full_optimization.py → examples/interleaved-thinking/reasoning_trace_optimizer/skill_generator.py
- `TraceAnalyzer` --uses--> `ReasoningTrace`  [INFERRED]
  examples/interleaved-thinking/reasoning_trace_optimizer/analyzer.py → examples/interleaved-thinking/reasoning_trace_optimizer/models.py
- `cmd_analyze()` --calls--> `TraceAnalyzer`  [INFERRED]
  examples/interleaved-thinking/reasoning_trace_optimizer/cli.py → examples/interleaved-thinking/reasoning_trace_optimizer/analyzer.py

## Import Cycles
- None detected.

## Communities (52 total, 4 thin omitted)

### Community 0 - "datetime"
Cohesion: 0.06
Nodes (34): datetime, execute_tool(), Example 3: Full Optimization Loop with Comprehensive Tools  Demonstrates the com, Execute a tool and return realistic results., ndarray, IntegratedMemorySystem, PropertyGraph, Any (+26 more)

### Community 1 - "description_generator.py"
Cohesion: 0.05
Nodes (37): Protocol, _BuiltToolSpec, ErrorMessageGenerator, _generate_errors(), _generate_parameters(), _generate_returns(), generate_tool_description(), generate_usage_context() (+29 more)

### Community 2 - "Any"
Cohesion: 0.06
Nodes (31): AgentEvaluator, EvaluationRunner, ProductionMonitor, Any, Enum, Agent Evaluation Framework for context-engineered agent systems.  Use when: buil, Main evaluation engine for agent outputs.      Use when: scoring a single agent, Evaluate agent output against task requirements.          Use when: you have a s (+23 more)

### Community 3 - "index.ts"
Cohesion: 0.11
Nodes (29): main(), main(), main(), main(), EvaluatorAgent, EvaluatorAgentConfig, config, validateConfig() (+21 more)

### Community 4 - "compaction.py"
Cohesion: 0.05
Nodes (36): calculate_cache_metrics(), categorize_messages(), ContextBudget, design_stable_prompt(), estimate_message_tokens(), estimate_token_count(), generate_cache_recommendations(), ObservationStore (+28 more)

### Community 5 - "pipeline_template.py"
Cohesion: 0.07
Nodes (47): call_llm(), extract_field(), extract_list_items(), extract_score(), extract_section(), fetch_items_from_source(), generate_prompt(), get_batch_dir() (+39 more)

### Community 6 - "CompressionEvaluator"
Cohesion: 0.07
Nodes (27): CompressionEvaluator, CriterionResult, evaluate_compression_quality(), EvaluationResult, Probe, ProbeGenerator, ProbeType, Enum (+19 more)

### Community 7 - "ScratchPadManager"
Cohesion: 0.07
Nodes (30): AgentPlan, _cleanup_demo(), _demo_plan_persistence(), _demo_scratch_pad(), _demo_tool_handler(), PlanStep, Any, Filesystem Context Manager -- composable utilities for filesystem-based context (+22 more)

### Community 8 - "context_manager.py"
Cohesion: 0.09
Nodes (27): build_agent_context(), ContextBuilder, count_tokens_by_type(), estimate_message_tokens(), estimate_token_count(), ProgressiveDisclosureManager, Any, Context Management Utilities for Agent Systems.  Public API ---------- Functions (+19 more)

### Community 9 - ".analyze"
Cohesion: 0.08
Nodes (23): analyze_agent_context(), analyze_context_structure(), ContextHealthAnalyzer, detect_lost_in_middle(), _estimate_attention(), measure_attention_distribution(), PoisoningDetector, Context Degradation Detection — Public API ===================================== (+15 more)

### Community 10 - "SkillGenerator"
Cohesion: 0.10
Nodes (24): cmd_generate_skill(), Generate a skill from optimization artifacts., LoopResult, Result of running the full optimization loop., _format_examples_to_markdown(), _format_list_to_markdown(), _format_numbered_list_to_markdown(), generate_skill_from_loop() (+16 more)

### Community 11 - "ReasoningTrace"
Cohesion: 0.11
Nodes (21): Get a quick overall score without full pattern analysis.          Useful for opt, Get excerpts from thinking blocks., Any, Process response content blocks and update trace., Execute a tool call and record it in the trace., Captures reasoning traces from MiniMax M2.1's interleaved thinking.      This cl, Execute a task with streaming output and capture reasoning trace.          Simil, Initialize TraceCapture with M2.1 configuration.          Args:             api_ (+13 more)

### Community 12 - "loop.py"
Cohesion: 0.10
Nodes (22): main(), Example 1: Basic Trace Capture  Demonstrates capturing reasoning traces from M2., Run a simple task and capture the reasoning trace., format_analysis_report(), TraceAnalyzer: Analyzes reasoning traces to detect patterns and issues.  Uses M2, Format an analysis result as a human-readable report., format_trace_for_display(), TraceCapture: Wraps M2.1 API to capture interleaved thinking traces.  This modul (+14 more)

### Community 13 - "OptimizationLoop"
Cohesion: 0.11
Nodes (20): main(), Run the full optimization loop with comprehensive tools., LoopConfig, OptimizationLoop, Any, Run the full optimization loop.          Args:             task: The task to opt, Run a single capture + analysis cycle (no optimization).          Useful for deb, Calculate weighted score from trace and analysis. (+12 more)

### Community 14 - "TraceAnalyzer"
Cohesion: 0.11
Nodes (20): Analyzes reasoning traces using M2.1 to detect patterns and score quality., Initialize TraceAnalyzer with M2.1 configuration.          Args:             api, Analyze a reasoning trace and return detailed analysis.          Args:, Analyze multiple traces and return results., Format thinking blocks for analysis., Format tool calls for analysis., Parse the JSON analysis response from M2.1., Fallback parsing when JSON extraction fails. (+12 more)

### Community 15 - "PromptOptimizer"
Cohesion: 0.10
Nodes (19): OptimizationResult, PromptDiff, Difference between original and optimized prompt., Result of prompt optimization., format_optimization_report(), PromptOptimizer, Any, Optimizes agent prompts based on reasoning trace analysis.      Uses M2.1's inte (+11 more)

### Community 16 - "package.json"
Cohesion: 0.08
Nodes (24): author, bugs, url, description, engines, node, homepage, keywords (+16 more)

### Community 17 - "compilerOptions"
Cohesion: 0.09
Nodes (22): compilerOptions, declaration, declarationMap, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, lib, module (+14 more)

### Community 18 - "Sandbox"
Cohesion: 0.09
Nodes (17): Any, Read a file from the sandbox filesystem.          Use when: agent needs to inspe, Write a file to the sandbox filesystem.          Use when: agent needs to modify, Create a snapshot of current filesystem state.          Use when: preserving ses, Create snapshot (infrastructure-specific)., Restore sandbox to a previous snapshot., Terminate the sandbox., Main manager for sandbox lifecycle.      Use when: orchestrating the full sandbo (+9 more)

### Community 19 - "WarmPoolManager"
Cohesion: 0.11
Nodes (16): Pre-built image for a repository.      Use when: checking whether a cached envir, Check if image is older than max age., Get the most recent image for a repository., A pre-warmed sandbox ready for use.      Use when: tracking warm pool inventory, Manages pools of pre-warmed sandboxes.      Use when: reducing cold start latenc, Get a pre-warmed sandbox if available.          Use when: a user submits a promp, Check if a warm sandbox is still valid., Ensure pool has target number of warm sandboxes.          Use when: called perio (+8 more)

### Community 20 - "ImageBuilder"
Cohesion: 0.24
Nodes (6): ImageBuilder, Builds and manages repository images.      Use when: setting up the periodic ima, Build a new image for a repository.          Use when: the current image is stal, Execute a build step (infrastructure-specific)., Get current HEAD commit SHA., Finalize and store the image, return image ID.

### Community 21 - "Any"
Cohesion: 0.18
Nodes (10): Any, Central supervisor agent that coordinates worker agents.      Use when: tasks ha, Register a worker agent with the supervisor., Decompose a task into subtasks.          Use when: a high-level task needs to be, Select the best available worker for a subtask.          Use when: the superviso, Aggregate results from completed subtasks., Execute a complete workflow with supervision.          Use when: running an end-, Simulate a worker completing a subtask.          In production, replace with act (+2 more)

### Community 22 - "test_models.py"
Cohesion: 0.12
Nodes (15): Tests for data models., Test LoopResult creation., Test all PatternType values exist., Test all Severity levels exist., Test ThinkingBlock creation with defaults., Test ToolCall creation., Test Pattern creation., Test AnalysisResult creation. (+7 more)

### Community 23 - "package.json"
Cohesion: 0.13
Nodes (15): author, bugs, url, description, exports, files, homepage, import (+7 more)

### Community 24 - "pipeline_example.py"
Cohesion: 0.17
Nodes (13): build_examples(), build_tinker_datum(), Chunk, generate_instruction(), Book SFT Pipeline - Conceptual Implementation  This demonstrates the core patter, Generate a scene description for the chunk.     Replace llm_call with your actua, Convert training example to Tinker Datum format.          Key insight: Weights o, Validate that the model learned style, not just memorized content. (+5 more)

### Community 25 - "scripts"
Cohesion: 0.13
Nodes (15): scripts, build, dev, example:basic, example:compare, example:full, example:rubric, format (+7 more)

### Community 26 - "_demo"
Cohesion: 0.22
Nodes (7): _demo(), Start the background image build loop.          Use when: initializing the syste, Called when user starts typing a prompt.          Use when: implementing predict, User identity for commit attribution.      Use when: configuring sandbox git ide, Read a file -- allowed even before sync completes.          Use when: agent need, Demonstrate sandbox manager usage end-to-end., UserIdentity

### Community 27 - "weekly_review.py"
Cohesion: 0.24
Nodes (12): analyze_content(), analyze_metrics(), analyze_network(), generate_review(), get_week_range(), load_jsonl(), Load JSONL file, skipping schema lines., Get the start and end of the current week. (+4 more)

### Community 28 - "AgentFailureHandler"
Cohesion: 0.18
Nodes (7): AgentFailureHandler, Handler for agent failures in multi-agent systems.      Use when: agents may fai, Handle a failure from an agent.          Use when: an agent reports an error and, Temporarily disable an agent (1-minute cooldown)., Find an alternative agent to handle the task.          In production, check agen, Check if an agent is available (circuit breaker not active)., Record a successful task completion, resetting failure count.

### Community 29 - "content_ideas.py"
Cohesion: 0.29
Nodes (10): generate_suggestions(), get_recent_bookmarks(), get_top_performing_content(), get_undeveloped_ideas(), load_jsonl(), Load JSONL file, skipping schema lines., Get posts with highest engagement., Get recent bookmarks, optionally filtered by category. (+2 more)

### Community 30 - "idea_to_draft.py"
Cohesion: 0.29
Nodes (10): find_idea(), find_related_bookmarks(), find_similar_posts(), generate_draft_scaffold(), load_jsonl(), Load JSONL file, skipping schema lines., Find an idea by ID or partial match., Find bookmarks related to the idea. (+2 more)

### Community 31 - "StructuredSummarizer"
Cohesion: 0.24
Nodes (6): Generate structured summaries with explicit sections.      Use when: implementin, Update summary from newly truncated content span.          Use when: a compressi, Extract structured information from content., Merge new information with existing sections., Format sections into summary string., StructuredSummarizer

### Community 32 - "AgentSession"
Cohesion: 0.25
Nodes (5): AgentSession, Agent session with file read/write coordination.      Use when: wrapping a Sandb, Write a file -- blocks until sync is complete.          Use when: agent needs to, Called when git sync is complete., Wait for sync to complete, then flush pending writes.

### Community 33 - "devDependencies"
Cohesion: 0.20
Nodes (10): devDependencies, eslint, @eslint/js, prettier, tsx, @types/node, typescript, typescript-eslint (+2 more)

### Community 34 - "AgentMessage"
Cohesion: 0.24
Nodes (6): AgentMessage, Assign a subtask to a worker agent., Send message through the communication channel., Accept the first pending handoff for an agent, if any., Message exchanged between agents.      Use when: agents need a structured envelo, Receive all messages for an agent, clearing its inbox.

### Community 35 - "stale_contacts.py"
Cohesion: 0.31
Nodes (8): days_since(), find_stale_contacts(), generate_report(), load_jsonl(), Load JSONL file, skipping schema lines., Calculate days since a date string., Find contacts needing outreach., Generate stale contacts report.

### Community 36 - "evaluation_example.py"
Cohesion: 0.28
Nodes (8): direct_scoring_example(), pairwise_comparison_example(), Any, Advanced Evaluation Example  Use when: building LLM-as-judge evaluation pipeline, Compare two responses with position-swapped bias mitigation.      Use when: eval, Generate a domain-specific scoring rubric for consistent evaluation.      Use wh, Rate a single response against defined criteria using direct scoring.      Use w, rubric_generation_example()

### Community 37 - "AgentCommunication"
Cohesion: 0.29
Nodes (4): AgentCommunication, Communication channel for multi-agent systems.      Use when: multiple agents ne, Send a message to an agent., Broadcast a message to multiple agents.

### Community 38 - "sandbox_manager.py"
Cohesion: 0.33
Nodes (6): Enum, Sandbox Manager for Hosted Agent Infrastructure.  Use when: building background, Sandbox lifecycle states., Configuration for sandbox creation.      Use when: defining resource limits and, SandboxConfig, SandboxState

### Community 39 - "ConsensusManager"
Cohesion: 0.29
Nodes (4): ConsensusManager, Manager for multi-agent consensus building.      Use when: multiple agents must, Initiate a voting round on a topic., Submit a vote for a topic with a confidence weight.

### Community 40 - "HandoffProtocol"
Cohesion: 0.33
Nodes (4): HandoffProtocol, Protocol for agent-to-agent handoffs.      Use when: implementing peer-to-peer o, Create a handoff message with transferred context., Transfer task state from one agent to another.          Use when: a handoff must

### Community 41 - "02_tool_usage.py"
Cohesion: 0.40
Nodes (5): execute_tool(), main(), Example 2: Tool Usage with Trace Capture  Demonstrates how M2.1's interleaved th, Run a task with tools and observe interleaved thinking., Execute a mock tool and return results.

### Community 42 - "dependencies"
Cohesion: 0.33
Nodes (6): dependencies, ai, @ai-sdk/anthropic, @ai-sdk/openai, dotenv, zod

### Community 43 - "coordination.py"
Cohesion: 0.50
Nodes (4): MessageType, Enum, Multi-Agent Coordination Utilities  Provides reusable building blocks for multi-, Types of messages exchanged between agents.

### Community 44 - "repository"
Cohesion: 0.67
Nodes (3): repository, type, url

## Knowledge Gaps
- **87 isolated node(s):** `name`, `version`, `description`, `keywords`, `author` (+82 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Sandbox` connect `Sandbox` to `AgentSession`, `WarmPoolManager`, `sandbox_manager.py`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **Why does `ReasoningTrace` connect `ReasoningTrace` to `loop.py`, `OptimizationLoop`, `TraceAnalyzer`, `PromptOptimizer`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **Why does `AnalysisResult` connect `TraceAnalyzer` to `SkillGenerator`, `loop.py`, `OptimizationLoop`, `PromptOptimizer`, `test_models.py`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **Are the 6 inferred relationships involving `ReasoningTrace` (e.g. with `TraceAnalyzer` and `TraceCapture`) actually correct?**
  _`ReasoningTrace` has 6 INFERRED edges - model-reasoned connections that need verification._
- **Are the 10 inferred relationships involving `OptimizationLoop` (e.g. with `main()` and `cmd_optimize()`) actually correct?**
  _`OptimizationLoop` has 10 INFERRED edges - model-reasoned connections that need verification._
- **Are the 9 inferred relationships involving `TraceAnalyzer` (e.g. with `AnalysisResult` and `Pattern`) actually correct?**
  _`TraceAnalyzer` has 9 INFERRED edges - model-reasoned connections that need verification._
- **Are the 6 inferred relationships involving `AnalysisResult` (e.g. with `TraceAnalyzer` and `LoopConfig`) actually correct?**
  _`AnalysisResult` has 6 INFERRED edges - model-reasoned connections that need verification._