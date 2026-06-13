(function () {
  "use strict";

  const STORAGE_KEY = "token-poker-mvp-v1";
  const EVEN_THRESHOLD = 0.2;
  const TOKEN_STEP = 50000;
  const TOKEN_MAX = 10000000;
  const TOKEN_SLIDER_MAX = 1000;
  const HOUR_STEP = 0.5;
  const FIBONACCI_POINTS = [0, 1, 2, 3, 5, 8, 13, 21, 34];

  const pricingSources = {
    anthropic: {
      provider: "Anthropic",
      label: "Claude API pricing",
      url: "https://platform.claude.com/docs/en/about-claude/pricing",
      checkedAt: "2026-06-10"
    },
    openai: {
      provider: "OpenAI",
      label: "API pricing",
      url: "https://openai.com/api/pricing/",
      checkedAt: "2026-06-10"
    },
    deepseek: {
      provider: "DeepSeek",
      label: "Models & Pricing",
      url: "https://api-docs.deepseek.com/quick_start/pricing",
      checkedAt: "2026-06-10"
    }
  };

  const defaultModelPricing = [
    model("claude-fable-5", "Anthropic", "Claude Fable 5", "Frontier", 10, 50, null, "highest capability", pricingSources.anthropic),
    model("claude-opus-4-8", "Anthropic", "Claude Opus 4.8", "Premium", 5, 25, null, "least review", pricingSources.anthropic),
    model("claude-sonnet-4-6", "Anthropic", "Claude Sonnet 4.6", "Mid", 3, 15, null, "balanced default", pricingSources.anthropic),
    model("claude-haiku-4-5", "Anthropic", "Claude Haiku 4.5", "Budget", 1, 5, null, "more iteration", pricingSources.anthropic),
    model("gpt-5-5", "OpenAI", "GPT-5.5", "Frontier", 5, 30, 0.5, "coding and professional work", pricingSources.openai),
    model("gpt-5-4", "OpenAI", "GPT-5.4", "Mid", 2.5, 15, 0.25, "price-performance default", pricingSources.openai),
    model("gpt-5-4-mini", "OpenAI", "GPT-5.4 mini", "Budget", 0.75, 4.5, 0.075, "mini coding model", pricingSources.openai),
    model("deepseek-v4-pro", "DeepSeek", "DeepSeek-V4-Pro", "Pro", 0.435, 0.87, 0.003625, "thinking-capable pro model", pricingSources.deepseek),
    model("deepseek-v4-flash", "DeepSeek", "DeepSeek-V4-Flash", "Budget", 0.14, 0.28, 0.0028, "low-cost thinking-capable model", pricingSources.deepseek)
  ];

  const defaultState = {
    config: {
      hourlyRate: 100,
      modelPricing: clone(defaultModelPricing),
      tokenSplit: {
        inputShare: 0.3,
        outputShare: 0.7
      }
    },
    task: {
      title: ""
    },
    players: [
      {
        id: "p1",
        name: "Player 1"
      },
      {
        id: "p2",
        name: "Player 2"
      }
    ],
    estimates: {},
    activePlayerId: "p1",
    phase: "estimating"
  };

  const legacyModelIds = {
    premium: "claude-opus-4-8",
    mid: "claude-sonnet-4-6",
    budget: "claude-haiku-4-5"
  };

  function model(id, provider, label, tier, inputPricePerMTok, outputPricePerMTok, cachedInputPricePerMTok, character, source) {
    const nextModel = {
      id,
      provider,
      label,
      tier,
      inputPricePerMTok,
      outputPricePerMTok,
      character,
      pricingSourceUrl: source.url,
      pricingCheckedAt: source.checkedAt
    };

    if (cachedInputPricePerMTok !== null) {
      nextModel.cachedInputPricePerMTok = cachedInputPricePerMTok;
    }

    return nextModel;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function roundTokensToStep(totalTokens, step = TOKEN_STEP) {
    const rounded = Math.round(numberOr(totalTokens, 0) / step) * step;
    return clamp(rounded, 0, TOKEN_MAX);
  }

  function roundHoursToStep(hours, step = HOUR_STEP) {
    const rounded = Math.round(numberOr(hours, step) / step) * step;
    return clamp(rounded, step, 80);
  }

  function sliderPositionToTokens(position) {
    const numericPosition = clamp(numberOr(position, 0), 0, TOKEN_SLIDER_MAX);
    if (numericPosition <= 0) {
      return 0;
    }

    const ratio = (numericPosition - 1) / (TOKEN_SLIDER_MAX - 1);
    const rawTokens = TOKEN_STEP * Math.exp(ratio * Math.log(TOKEN_MAX / TOKEN_STEP));
    return roundTokensToStep(rawTokens);
  }

  function tokensToSliderPosition(totalTokens) {
    const tokens = roundTokensToStep(totalTokens);
    if (tokens <= 0) {
      return 0;
    }

    const ratio = Math.log(tokens / TOKEN_STEP) / Math.log(TOKEN_MAX / TOKEN_STEP);
    return clamp(Math.round(1 + ratio * (TOKEN_SLIDER_MAX - 1)), 0, TOKEN_SLIDER_MAX);
  }

  function getTokenBreakdown(estimate, modelTier, tokenSplit) {
    const totalTokens = roundTokensToStep(estimate.totalTokens);
    const split = normalizeTokenSplit(tokenSplit);
    const inputTokens = totalTokens * split.inputShare;
    const outputTokens = totalTokens * split.outputShare;
    const inputCost = (inputTokens / 1000000) * modelTier.inputPricePerMTok;
    const outputCost = (outputTokens / 1000000) * modelTier.outputPricePerMTok;
    return {
      totalTokens,
      inputTokens,
      outputTokens,
      inputCost,
      outputCost,
      tokenCost: inputCost + outputCost
    };
  }

  function getTokenSpend(estimate, modelTier, tokenSplit) {
    return getTokenBreakdown(estimate, modelTier, tokenSplit).tokenCost;
  }

  function getPlayerResult(player, estimate, config) {
    if (!estimate) {
      return null;
    }

    const modelTier = findModel(config.modelPricing, estimate.modelTierId);
    const tokenBreakdown = getTokenBreakdown(estimate, modelTier, config.tokenSplit);
    const noAiValue = estimate.noAiHours * config.hourlyRate;
    return {
      player,
      estimate,
      modelTier,
      fibonacciPoints: estimate.fibonacciPoints,
      noAiHours: estimate.noAiHours,
      noAiValue,
      tokenBreakdown,
      tokenCost: tokenBreakdown.tokenCost,
      netSavings: noAiValue - tokenBreakdown.tokenCost
    };
  }

  function getTeamSummary(results) {
    const points = results.map((result) => result.fibonacciPoints);
    const tokenCosts = results.map((result) => result.tokenCost);
    const netSavings = results.map((result) => result.netSavings);
    const totalTokens = results.map((result) => result.tokenBreakdown.totalTokens);
    const modelDistribution = results.reduce((models, result) => {
      models[result.modelTier.label] = (models[result.modelTier.label] || 0) + 1;
      return models;
    }, {});

    return {
      minPoints: points.length ? Math.min(...points) : 0,
      medianPoints: median(points),
      maxPoints: points.length ? Math.max(...points) : 0,
      minTokenCost: tokenCosts.length ? Math.min(...tokenCosts) : 0,
      medianTokenCost: median(tokenCosts),
      maxTokenCost: tokenCosts.length ? Math.max(...tokenCosts) : 0,
      minNetSavings: netSavings.length ? Math.min(...netSavings) : 0,
      medianNetSavings: median(netSavings),
      maxNetSavings: netSavings.length ? Math.max(...netSavings) : 0,
      minTotalTokens: totalTokens.length ? Math.min(...totalTokens) : 0,
      medianTotalTokens: median(totalTokens),
      maxTotalTokens: totalTokens.length ? Math.max(...totalTokens) : 0,
      modelDistribution
    };
  }

  function getVerdict(summary) {
    if (summary.medianNetSavings < 0) {
      return "uneconomical";
    }

    if (summary.maxPoints <= 3 && summary.medianTokenCost >= 25) {
      return "agglomerate";
    }

    if (summary.maxTotalTokens - summary.minTotalTokens >= Math.max(500000, summary.medianTotalTokens)) {
      return "token-spread";
    }

    if (summary.maxPoints - summary.minPoints >= 8) {
      return "point-spread";
    }

    if (summary.medianPoints >= 8 && summary.medianNetSavings > 0) {
      return "delegate";
    }

    return Math.abs(summary.medianNetSavings) <= Math.max(10, summary.medianTokenCost * EVEN_THRESHOLD)
      ? "even"
      : "delegate";
  }

  function getInsight(verdict, results, summary = getTeamSummary(results)) {
    if (!results.length) {
      return "Submit estimates to reveal the token economics.";
    }

    if (verdict === "uneconomical") {
      return "Token cost exceeds the no-AI labor value. As a standalone delegation, this looks uneconomical.";
    }

    if (verdict === "agglomerate") {
      return "This is low-point work with meaningful token cost. Agglomerate it with related work before delegating.";
    }

    if (verdict === "token-spread") {
      return "Token estimates vary widely. Discuss implementation shape before deciding whether to delegate.";
    }

    if (verdict === "point-spread") {
      return "Point estimates vary widely. Discuss scope and complexity before comparing token economics.";
    }

    if (verdict === "even") {
      return "Savings are close to token cost. Decide based on repeatability, risk, and learning value.";
    }

    return `Strong delegation candidate: median net savings are ${formatMoney(summary.medianNetSavings)} before any prompting-time estimate.`;
  }

  function median(values) {
    if (!values.length) {
      return 0;
    }

    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function findModel(models, modelId) {
    const normalizedId = legacyModelIds[modelId] || modelId;
    return models.find((item) => item.id === normalizedId) || models[0];
  }

  function normalizeTokenSplit(tokenSplit) {
    const inputShare = clamp(numberOr(tokenSplit?.inputShare, 0.3), 0, 1);
    const outputShare = clamp(numberOr(tokenSplit?.outputShare, 1 - inputShare), 0, 1);
    const total = inputShare + outputShare;

    if (total <= 0) {
      return {
        inputShare: 0.3,
        outputShare: 0.7
      };
    }

    return {
      inputShare: inputShare / total,
      outputShare: outputShare / total
    };
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function numberOr(value, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  }

  function formatMoney(value) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: Math.abs(value) >= 10 ? 0 : 2
    }).format(value);
  }

  function formatHours(value) {
    return `${Number(value).toFixed(1)}h`;
  }

  function formatTokens(value) {
    const tokens = roundTokensToStep(value);
    if (tokens >= 1000000) {
      return `${(tokens / 1000000).toLocaleString("en-US", {
        maximumFractionDigits: tokens % 1000000 === 0 ? 0 : 1
      })}M`;
    }

    if (tokens >= 1000) {
      return `${Math.round(tokens / 1000).toLocaleString("en-US")}K`;
    }

    return tokens.toLocaleString("en-US");
  }

  function formatFullTokens(value) {
    return `${Math.round(value).toLocaleString("en-US")} tokens`;
  }

  function formatPrice(value) {
    if (value === undefined || value === null || value === "") {
      return "n/a";
    }

    return `$${Number(value).toLocaleString("en-US", {
      maximumFractionDigits: 6
    })}`;
  }

  function initApp(root) {
    let state = loadState();
    const els = {
      sessionStatus: root.querySelector("#sessionStatus"),
      taskTitle: root.querySelector("#taskTitle"),
      hourlyRate: root.querySelector("#hourlyRate"),
      activePlayer: root.querySelector("#activePlayer"),
      playerList: root.querySelector("#playerList"),
      addPlayer: root.querySelector("#addPlayer"),
      activePlayerHelp: root.querySelector("#activePlayerHelp"),
      activePlayerStatus: root.querySelector("#activePlayerStatus"),
      fibonacciPoints: root.querySelector("#fibonacciPoints"),
      noAiHours: root.querySelector("#noAiHours"),
      noAiHoursValue: root.querySelector("#noAiHoursValue"),
      estimateModel: root.querySelector("#estimateModel"),
      tokenSlider: root.querySelector("#tokenSlider"),
      tokenValue: root.querySelector("#tokenValue"),
      tokenNumber: root.querySelector("#tokenNumber"),
      saveEstimate: root.querySelector("#saveEstimate"),
      nextPlayer: root.querySelector("#nextPlayer"),
      reveal: root.querySelector("#reveal"),
      revote: root.querySelector("#revote"),
      newTask: root.querySelector("#newTask"),
      resetSession: root.querySelector("#resetSession"),
      resetPricing: root.querySelector("#resetPricing"),
      inputShare: root.querySelector("#inputShare"),
      outputShare: root.querySelector("#outputShare"),
      pricingRows: root.querySelector("#pricingRows"),
      pricingSources: root.querySelector("#pricingSources"),
      resultsView: root.querySelector("#resultsView")
    };

    wireEvents();
    render();

    function wireEvents() {
      els.taskTitle.addEventListener("input", () => {
        state.task.title = els.taskTitle.value;
        state.phase = "estimating";
        saveState(state);
        renderResults();
      });

      els.hourlyRate.addEventListener("input", () => {
        state.config.hourlyRate = numberOr(els.hourlyRate.value, 100);
        state.phase = "estimating";
        saveState(state);
        renderResults();
      });

      els.activePlayer.addEventListener("change", () => {
        state.activePlayerId = els.activePlayer.value;
        saveState(state);
        renderEstimateForm();
        renderPlayers();
      });

      els.fibonacciPoints.addEventListener("change", () => {
        const estimate = getActiveEstimate();
        state.estimates[state.activePlayerId] = {
          ...estimate,
          fibonacciPoints: Number(els.fibonacciPoints.value)
        };
        state.phase = "estimating";
        saveState(state);
        renderPlayers();
        renderResults();
      });

      els.noAiHours.addEventListener("input", () => {
        updateRangeLabels();
      });

      els.estimateModel.addEventListener("change", () => {
        const estimate = getActiveEstimate();
        state.estimates[state.activePlayerId] = {
          ...estimate,
          modelTierId: els.estimateModel.value
        };
        state.phase = "estimating";
        saveState(state);
        renderPlayers();
        renderResults();
      });

      els.tokenSlider.addEventListener("input", () => {
        setTokenControls(sliderPositionToTokens(els.tokenSlider.value));
      });

      els.tokenNumber.addEventListener("input", () => {
        setTokenControls(roundTokensToStep(els.tokenNumber.value));
      });

      els.inputShare.addEventListener("input", () => {
        const inputPercent = clamp(numberOr(els.inputShare.value, 30), 0, 100);
        state.config.tokenSplit = {
          inputShare: inputPercent / 100,
          outputShare: (100 - inputPercent) / 100
        };
        state.phase = "estimating";
        saveState(state);
        renderSplitControls();
        renderResults();
      });

      els.outputShare.addEventListener("input", () => {
        const outputPercent = clamp(numberOr(els.outputShare.value, 70), 0, 100);
        state.config.tokenSplit = {
          inputShare: (100 - outputPercent) / 100,
          outputShare: outputPercent / 100
        };
        state.phase = "estimating";
        saveState(state);
        renderSplitControls();
        renderResults();
      });

      els.saveEstimate.addEventListener("click", () => {
        saveActiveEstimate();
        render();
      });

      els.nextPlayer.addEventListener("click", () => {
        saveActiveEstimate();
        moveToNextPlayer();
        render();
      });

      els.reveal.addEventListener("click", () => {
        if (!allSubmitted()) {
          return;
        }

        state.phase = "revealed";
        saveState(state);
        render();
      });

      els.revote.addEventListener("click", () => {
        state.estimates = {};
        state.phase = "estimating";
        saveState(state);
        render();
      });

      els.newTask.addEventListener("click", () => {
        state.task = {
          title: ""
        };
        state.estimates = {};
        state.phase = "estimating";
        saveState(state);
        render();
      });

      els.resetSession.addEventListener("click", () => {
        state = clone(defaultState);
        saveState(state);
        render();
      });

      els.addPlayer.addEventListener("click", () => {
        if (state.players.length >= 6) {
          return;
        }

        const player = {
          id: `p${Date.now()}`,
          name: `Player ${state.players.length + 1}`
        };
        state.players.push(player);
        state.activePlayerId = player.id;
        state.phase = "estimating";
        saveState(state);
        render();
      });

      els.resetPricing.addEventListener("click", () => {
        state.config.modelPricing = clone(defaultModelPricing);
        state.config.tokenSplit = clone(defaultState.config.tokenSplit);
        state.phase = "estimating";
        saveState(state);
        render();
      });
    }

    function loadState() {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (!stored) {
        return clone(defaultState);
      }

      try {
        return normalizeState({
          ...clone(defaultState),
          ...JSON.parse(stored)
        });
      } catch {
        return clone(defaultState);
      }
    }

    function saveState(nextState) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
    }

    function normalizeState(nextState) {
      const normalized = {
        ...nextState,
        config: {
          ...clone(defaultState.config),
          ...nextState.config,
          modelPricing: mergeModelPricing(nextState.config?.modelPricing),
          tokenSplit: normalizeTokenSplit(nextState.config?.tokenSplit)
        },
        task: {
          title: nextState.task?.title || ""
        },
        players: Array.isArray(nextState.players) && nextState.players.length ? nextState.players.slice(0, 6) : clone(defaultState.players),
        estimates: {
          ...nextState.estimates
        },
        phase: nextState.phase === "revealed" ? "revealed" : "estimating"
      };

      if (!normalized.players.some((player) => player.id === normalized.activePlayerId)) {
        normalized.activePlayerId = normalized.players[0].id;
      }

      Object.entries(normalized.estimates).forEach(([playerId, estimate]) => {
        if (!normalized.players.some((player) => player.id === playerId)) {
          delete normalized.estimates[playerId];
          return;
        }

        normalized.estimates[playerId] = {
          fibonacciPoints: nearestPoint(estimate.fibonacciPoints ?? estimate.points ?? 3),
          noAiHours: roundHoursToStep(estimate.noAiHours ?? estimate.handCodeHours ?? 2),
          modelTierId: legacyModelIds[estimate.modelTierId] || estimate.modelTierId || "claude-sonnet-4-6",
          totalTokens: roundTokensToStep(estimate.totalTokens ?? 250000)
        };
      });

      return normalized;
    }

    function mergeModelPricing(storedPricing) {
      if (!Array.isArray(storedPricing)) {
        return clone(defaultModelPricing);
      }

      return defaultModelPricing.map((defaultModel) => {
        const storedModel = storedPricing.find((item) => item.id === defaultModel.id);
        if (!storedModel) {
          return clone(defaultModel);
        }

        return {
          ...clone(defaultModel),
          inputPricePerMTok: numberOr(storedModel.inputPricePerMTok, defaultModel.inputPricePerMTok),
          outputPricePerMTok: numberOr(storedModel.outputPricePerMTok, defaultModel.outputPricePerMTok),
          cachedInputPricePerMTok:
            storedModel.cachedInputPricePerMTok === undefined
              ? defaultModel.cachedInputPricePerMTok
              : numberOr(storedModel.cachedInputPricePerMTok, defaultModel.cachedInputPricePerMTok)
        };
      });
    }

    function render() {
      renderTask();
      renderPlayers();
      renderEstimateForm();
      renderPricing();
      renderResults();
    }

    function renderTask() {
      els.taskTitle.value = state.task.title;
      els.hourlyRate.value = state.config.hourlyRate;
    }

    function renderPlayers() {
      const submittedCount = Object.keys(state.estimates).length;
      els.sessionStatus.textContent = `${submittedCount} of ${state.players.length} estimates submitted`;
      els.addPlayer.disabled = state.players.length >= 6;
      els.activePlayer.innerHTML = state.players
        .map((player) => `<option value="${escapeAttr(player.id)}">${escapeHtml(player.name)}</option>`)
        .join("");
      els.activePlayer.value = state.activePlayerId;
      els.playerList.innerHTML = state.players.map(renderPlayerRow).join("");

      els.playerList.querySelectorAll("[data-player-name]").forEach((input) => {
        input.addEventListener("input", () => {
          const player = state.players.find((item) => item.id === input.dataset.playerName);
          if (!player) {
            return;
          }

          player.name = input.value || "Unnamed";
          saveState(state);
          renderEstimateForm();
          renderResults();
          renderActivePlayerOptionsOnly();
        });
      });

      els.playerList.querySelectorAll("[data-remove-player]").forEach((button) => {
        button.addEventListener("click", () => {
          if (state.players.length <= 1) {
            return;
          }

          const playerId = button.dataset.removePlayer;
          state.players = state.players.filter((player) => player.id !== playerId);
          delete state.estimates[playerId];
          if (state.activePlayerId === playerId) {
            state.activePlayerId = state.players[0].id;
          }
          state.phase = "estimating";
          saveState(state);
          render();
        });
      });
    }

    function renderPlayerRow(player) {
      const submitted = Boolean(state.estimates[player.id]);
      const active = player.id === state.activePlayerId;
      return `
        <div class="player-row">
          <div class="player-main">
            <input data-player-name="${escapeAttr(player.id)}" value="${escapeAttr(player.name)}" aria-label="${escapeAttr(player.name)} name">
            <span class="player-meta">${active ? "Current player" : "Waiting"}</span>
          </div>
          <span class="pill ${submitted ? "done" : ""}">${submitted ? "Submitted" : "Open"}</span>
          <button class="icon-button" data-remove-player="${escapeAttr(player.id)}" type="button" aria-label="Remove ${escapeAttr(player.name)}">x</button>
        </div>
      `;
    }

    function renderActivePlayerOptionsOnly() {
      const current = state.activePlayerId;
      els.activePlayer.innerHTML = state.players
        .map((player) => `<option value="${escapeAttr(player.id)}">${escapeHtml(player.name)}</option>`)
        .join("");
      els.activePlayer.value = current;
    }

    function renderEstimateForm() {
      const player = state.players.find((item) => item.id === state.activePlayerId);
      const estimate = getActiveEstimate();
      const submitted = Boolean(state.estimates[state.activePlayerId]);
      els.activePlayerHelp.textContent = player ? `Entering estimate for ${player.name}.` : "Choose an active player.";
      els.fibonacciPoints.innerHTML = FIBONACCI_POINTS.map((point) => `<option value="${point}">${point}</option>`).join("");
      els.fibonacciPoints.value = estimate.fibonacciPoints;
      els.noAiHours.value = estimate.noAiHours;
      els.estimateModel.innerHTML = state.config.modelPricing
        .map((item) => `<option value="${escapeAttr(item.id)}">${escapeHtml(item.label)} (${escapeHtml(item.provider)})</option>`)
        .join("");
      els.estimateModel.value = legacyModelIds[estimate.modelTierId] || estimate.modelTierId;
      setTokenControls(estimate.totalTokens);
      els.activePlayerStatus.textContent = submitted ? "Submitted" : "Open";
      els.activePlayerStatus.className = `pill ${submitted ? "done" : ""}`;
      updateRangeLabels();
    }

    function renderPricing() {
      renderSplitControls();
      els.pricingRows.innerHTML = state.config.modelPricing.map(renderPricingRow).join("");
      els.pricingRows.querySelectorAll("[data-price-field]").forEach((input) => {
        input.addEventListener("input", () => {
          const modelTier = state.config.modelPricing.find((item) => item.id === input.dataset.modelId);
          if (!modelTier) {
            return;
          }

          modelTier[input.dataset.priceField] = numberOr(input.value, 0);
          state.phase = "estimating";
          saveState(state);
          renderResults();
        });
      });

      els.pricingSources.innerHTML = Object.values(pricingSources)
        .map(
          (source) =>
            `<span>${escapeHtml(source.provider)}: <a href="${escapeAttr(source.url)}">${escapeHtml(source.label)}</a>, checked ${escapeHtml(source.checkedAt)}</span>`
        )
        .join("");
    }

    function renderSplitControls() {
      const split = normalizeTokenSplit(state.config.tokenSplit);
      els.inputShare.value = Math.round(split.inputShare * 100);
      els.outputShare.value = Math.round(split.outputShare * 100);
    }

    function renderPricingRow(modelTier) {
      return `
        <tr>
          <td>
            <div class="model-name">
              <strong>${escapeHtml(modelTier.label)}</strong>
              <span>${escapeHtml(modelTier.provider)} ${escapeHtml(modelTier.tier)} - ${escapeHtml(modelTier.character)}</span>
            </div>
          </td>
          <td><input class="price-input" data-model-id="${escapeAttr(modelTier.id)}" data-price-field="inputPricePerMTok" type="number" min="0" step="0.000001" value="${escapeAttr(modelTier.inputPricePerMTok)}" aria-label="${escapeAttr(modelTier.label)} input price"></td>
          <td><input class="price-input" data-model-id="${escapeAttr(modelTier.id)}" data-price-field="outputPricePerMTok" type="number" min="0" step="0.000001" value="${escapeAttr(modelTier.outputPricePerMTok)}" aria-label="${escapeAttr(modelTier.label)} output price"></td>
          <td>${modelTier.cachedInputPricePerMTok === undefined ? "n/a" : formatPrice(modelTier.cachedInputPricePerMTok)}</td>
        </tr>
      `;
    }

    function renderResults() {
      const submittedCount = Object.keys(state.estimates).length;
      const ready = allSubmitted();
      els.sessionStatus.textContent = `${submittedCount} of ${state.players.length} estimates submitted`;
      els.reveal.disabled = !ready;

      if (state.phase !== "revealed") {
        els.resultsView.innerHTML = `
          <div class="empty">
            ${ready ? "Ready to reveal." : "Waiting for every player to submit."}
          </div>
        `;
        return;
      }

      const results = getResults();
      const summary = getTeamSummary(results);
      const verdict = getVerdict(summary);
      const insight = getInsight(verdict, results, summary);
      const maxValue = Math.max(1, ...results.flatMap((result) => [result.noAiValue, result.tokenCost]));
      els.resultsView.innerHTML = `
        <div class="summary-strip">
          <div class="metric">
            <span>Points</span>
            <strong>${summary.minPoints} / ${summary.medianPoints} / ${summary.maxPoints}</strong>
          </div>
          <div class="metric">
            <span>Token cost</span>
            <strong>${formatMoney(summary.minTokenCost)} / ${formatMoney(summary.medianTokenCost)} / ${formatMoney(summary.maxTokenCost)}</strong>
          </div>
          <div class="metric">
            <span>Net savings</span>
            <strong>${formatMoney(summary.minNetSavings)} / ${formatMoney(summary.medianNetSavings)} / ${formatMoney(summary.maxNetSavings)}</strong>
          </div>
        </div>
        <div class="insight">${escapeHtml(insight)}</div>
        <p class="section-note">Model distribution: ${escapeHtml(formatModelDistribution(summary.modelDistribution))}</p>
        <div class="result-list">
          ${results.map((result) => renderResultCard(result, maxValue)).join("")}
        </div>
        ${verdict === "agglomerate" || verdict === "uneconomical" ? renderScopeLadder() : ""}
      `;
    }

    function renderResultCard(result, maxValue) {
      const laborWidth = Math.max(3, Math.round((result.noAiValue / maxValue) * 100));
      const tokenWidth = Math.max(3, Math.round((result.tokenCost / maxValue) * 100));
      const positive = result.netSavings >= 0;

      return `
        <article class="result-card">
          <div class="result-top">
            <strong>${escapeHtml(result.player.name)} <span class="player-meta">${result.fibonacciPoints} pts - ${escapeHtml(result.modelTier.label)}</span></strong>
            <span class="delta ${positive ? "ai" : ""}">${positive ? "Savings" : "Over"} ${formatMoney(Math.abs(result.netSavings))}</span>
          </div>
          <div class="bar-pair">
            <div class="bar-row">
              <span>No AI</span>
              <span class="track"><span class="fill" style="--w: ${laborWidth}%"></span></span>
              <span>${formatMoney(result.noAiValue)}</span>
            </div>
            <div class="bar-row">
              <span>Tokens</span>
              <span class="track"><span class="fill ai-token" style="--human-w: 0%; --token-w: ${tokenWidth}%"></span></span>
              <span>${formatMoney(result.tokenCost)}</span>
            </div>
          </div>
          <p class="section-note">
            ${formatHours(result.noAiHours)} without AI = ${formatMoney(result.noAiValue)}.
            ${formatTokens(result.tokenBreakdown.totalTokens)} tokens split into
            ${formatFullTokens(result.tokenBreakdown.inputTokens)} input and
            ${formatFullTokens(result.tokenBreakdown.outputTokens)} output.
          </p>
        </article>
      `;
    }

    function renderScopeLadder() {
      return `
        <div class="scope-ladder">
          <h3>Agglomeration ladder</h3>
          <div class="ladder">
            <button type="button">This tweak</button>
            <button type="button">This bug class</button>
            <button type="button">This component</button>
            <button type="button">This workflow</button>
            <button type="button">This subsystem</button>
          </div>
        </div>
      `;
    }

    function getResults() {
      return state.players
        .map((player) => getPlayerResult(player, state.estimates[player.id], state.config))
        .filter(Boolean);
    }

    function getActiveEstimate() {
      return (
        state.estimates[state.activePlayerId] || {
          fibonacciPoints: 3,
          noAiHours: 2,
          modelTierId: "claude-sonnet-4-6",
          totalTokens: 250000
        }
      );
    }

    function saveActiveEstimate() {
      state.estimates[state.activePlayerId] = {
        fibonacciPoints: Number(els.fibonacciPoints.value),
        noAiHours: roundHoursToStep(els.noAiHours.value),
        modelTierId: els.estimateModel.value,
        totalTokens: roundTokensToStep(els.tokenNumber.value)
      };
      state.phase = "estimating";
      saveState(state);
    }

    function moveToNextPlayer() {
      const currentIndex = state.players.findIndex((player) => player.id === state.activePlayerId);
      const nextIndex = (currentIndex + 1) % state.players.length;
      state.activePlayerId = state.players[nextIndex].id;
      saveState(state);
    }

    function allSubmitted() {
      return state.players.length > 0 && state.players.every((player) => Boolean(state.estimates[player.id]));
    }

    function updateRangeLabels() {
      els.noAiHoursValue.textContent = formatHours(els.noAiHours.value);
    }

    function setTokenControls(totalTokens) {
      const tokens = roundTokensToStep(totalTokens);
      els.tokenSlider.value = tokensToSliderPosition(tokens);
      els.tokenNumber.value = tokens;
      els.tokenValue.textContent = formatTokens(tokens);
    }
  }

  function nearestPoint(value) {
    const numeric = numberOr(value, 3);
    return FIBONACCI_POINTS.reduce((nearest, point) =>
      Math.abs(point - numeric) < Math.abs(nearest - numeric) ? point : nearest
    );
  }

  function formatModelDistribution(distribution) {
    return Object.entries(distribution)
      .map(([modelName, count]) => `${modelName} (${count})`)
      .join(", ");
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }

  async function runTests(outputEl) {
    const sonnet = defaultModelPricing.find((item) => item.id === "claude-sonnet-4-6");
    const deepseek = defaultModelPricing.find((item) => item.id === "deepseek-v4-pro");
    const estimate = {
      fibonacciPoints: 5,
      noAiHours: 4,
      modelTierId: "claude-sonnet-4-6",
      totalTokens: 1000000
    };
    const config = {
      hourlyRate: 100,
      modelPricing: clone(defaultModelPricing),
      tokenSplit: {
        inputShare: 0.3,
        outputShare: 0.7
      }
    };
    const player = {
      id: "p1",
      name: "Tester"
    };
    const tests = [];

    assert(tests, "Log slider maps zero to zero tokens", sliderPositionToTokens(0) === 0);
    assert(tests, "Log slider maps max to 10M tokens", sliderPositionToTokens(TOKEN_SLIDER_MAX) === TOKEN_MAX);
    assert(tests, "Token values round to 50K increments", roundTokensToStep(124999) === 100000 && roundTokensToStep(125000) === 150000);
    assert(tests, "Token position round trips on 1M", sliderPositionToTokens(tokensToSliderPosition(1000000)) === 1000000);
    assert(tests, "Total tokens split by 30/70", near(getTokenBreakdown(estimate, sonnet, config.tokenSplit).inputTokens, 300000));
    assert(tests, "Sonnet token spend uses total tokens and split", near(getTokenSpend(estimate, sonnet, config.tokenSplit), 11.4));

    const deepseekEstimate = {
      ...estimate,
      totalTokens: 1000000,
      modelTierId: "deepseek-v4-pro"
    };
    assert(tests, "DeepSeek uses cache-miss input pricing by default", near(getTokenSpend(deepseekEstimate, deepseek, config.tokenSplit), 0.7395));

    const result = getPlayerResult(player, estimate, config);
    assert(tests, "No-AI hours use hourly rate to calculate avoided value", near(result.noAiValue, 400));
    assert(tests, "No-AI hours round to half-hour increments", roundHoursToStep(2.24) === 2 && roundHoursToStep(2.25) === 2.5);
    assert(tests, "Net savings equals no-AI value minus token cost", near(result.netSavings, 388.6));

    const editedConfig = clone(config);
    editedConfig.modelPricing.find((item) => item.id === "claude-sonnet-4-6").outputPricePerMTok = 30;
    const editedResult = getPlayerResult(player, estimate, editedConfig);
    assert(tests, "Edited pricing affects token cost", editedResult.tokenCost > result.tokenCost);

    const summary = getTeamSummary([
      { fibonacciPoints: 2, tokenCost: 10, netSavings: 90, tokenBreakdown: { totalTokens: 100000 }, modelTier: { label: "A" } },
      { fibonacciPoints: 5, tokenCost: 20, netSavings: 180, tokenBreakdown: { totalTokens: 200000 }, modelTier: { label: "A" } },
      { fibonacciPoints: 8, tokenCost: 30, netSavings: 270, tokenBreakdown: { totalTokens: 300000 }, modelTier: { label: "B" } }
    ]);
    assert(tests, "Team summary returns median points", summary.medianPoints === 5);
    assert(tests, "Team summary returns median token cost", summary.medianTokenCost === 20);
    assert(tests, "Model distribution counts choices", summary.modelDistribution.A === 2 && summary.modelDistribution.B === 1);
    assert(tests, "Insight can flag agglomeration", getInsight("agglomerate", [result], summary).includes("Agglomerate"));

    await runWorkflowTests(tests);

    const failed = tests.filter((item) => !item.pass);
    outputEl.textContent = tests.map((item) => `${item.pass ? "PASS" : "FAIL"} ${item.name}`).join("\n");
    outputEl.dataset.status = failed.length ? "failed" : "passed";
  }

  async function runWorkflowTests(tests) {
    const priorSession = window.localStorage.getItem(STORAGE_KEY);
    const frame = document.createElement("iframe");
    frame.style.position = "absolute";
    frame.style.left = "-9999px";
    frame.style.width = "420px";
    frame.style.height = "720px";

    try {
      window.localStorage.removeItem(STORAGE_KEY);
      document.body.appendChild(frame);
      await loadFrame(frame, "./index.html?test=initial");

      let doc = frame.contentDocument;
      assert(tests, "All default pricing rows render", doc.querySelectorAll("#pricingRows tr").length === 9);
      assert(tests, "Reveal is disabled until every player has submitted", doc.querySelector("#reveal").disabled === true);
      assert(tests, "Token slider uses log position scale", doc.querySelector("#tokenSlider").max === "1000");
      assert(tests, "No-AI hour slider uses half-hour increments", doc.querySelector("#noAiHours").step === "0.5");

      doc.querySelector("#tokenNumber").value = "125000";
      doc.querySelector("#tokenNumber").dispatchEvent(new Event("input", { bubbles: true }));
      assert(tests, "Token number and slider stay synced", doc.querySelector("#tokenNumber").value === "150000" && Number(doc.querySelector("#tokenSlider").value) > 0);

      click(doc, "#saveEstimate");
      click(doc, "#nextPlayer");
      doc.querySelector("#fibonacciPoints").value = "8";
      doc.querySelector("#noAiHours").value = "6";
      doc.querySelector("#tokenNumber").value = "500000";
      doc.querySelector("#tokenNumber").dispatchEvent(new Event("input", { bubbles: true }));
      click(doc, "#saveEstimate");
      assert(tests, "Reveal enables after every player submits", doc.querySelector("#reveal").disabled === false);

      const taskTitle = doc.querySelector("#taskTitle");
      taskTitle.value = "Persisted local task";
      taskTitle.dispatchEvent(new Event("input", { bubbles: true }));
      click(doc, "#reveal");
      assert(tests, "Reveal shows one result per player", doc.querySelectorAll(".result-card").length === 2);

      await loadFrame(frame, "./index.html?test=restore");
      doc = frame.contentDocument;
      assert(tests, "localStorage restores the current task", doc.querySelector("#taskTitle").value === "Persisted local task");
      assert(tests, "localStorage restores submitted estimates", doc.querySelector("#sessionStatus").textContent.includes("2 of 2"));
      assert(tests, "localStorage restores points, no-AI hours, and token count", doc.querySelector("#fibonacciPoints").value === "8" && doc.querySelector("#noAiHours").value === "6" && doc.querySelector("#tokenNumber").value === "500000");

      click(doc, "#nextPlayer");
      assert(tests, "localStorage restores first player token count", doc.querySelector("#fibonacciPoints").value === "3" && doc.querySelector("#noAiHours").value === "2" && doc.querySelector("#tokenNumber").value === "150000");

      click(doc, "#revote");
      assert(tests, "Revote clears estimates", doc.querySelector("#sessionStatus").textContent.includes("0 of 2"));
      assert(tests, "Revote keeps task and players", doc.querySelector("#taskTitle").value === "Persisted local task" && doc.querySelectorAll(".player-row").length === 2);

      click(doc, "#newTask");
      assert(tests, "New task resets task and estimates", doc.querySelector("#taskTitle").value === "" && doc.querySelector("#sessionStatus").textContent.includes("0 of 2"));
    } finally {
      frame.remove();
      if (priorSession === null) {
        window.localStorage.removeItem(STORAGE_KEY);
      } else {
        window.localStorage.setItem(STORAGE_KEY, priorSession);
      }
    }
  }

  function loadFrame(frame, url) {
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error(`Timed out loading ${url}`)), 3000);
      frame.addEventListener(
        "load",
        () => {
          window.clearTimeout(timer);
          resolve();
        },
        { once: true }
      );
      frame.src = url;
    });
  }

  function click(doc, selector) {
    const target = doc.querySelector(selector);
    if (!target) {
      throw new Error(`Missing target ${selector}`);
    }

    target.click();
  }

  function assert(tests, name, pass) {
    tests.push({
      name,
      pass: Boolean(pass)
    });
  }

  function near(actual, expected) {
    return Math.abs(actual - expected) < 0.000001;
  }

  window.TokenPokerApp = {
    defaultModelPricing,
    FIBONACCI_POINTS,
    TOKEN_MAX,
    TOKEN_STEP,
    HOUR_STEP,
    getTokenSpend,
    getTokenBreakdown,
    getPlayerResult,
    getTeamSummary,
    getVerdict,
    getInsight,
    roundTokensToStep,
    roundHoursToStep,
    sliderPositionToTokens,
    tokensToSliderPosition,
    runTests
  };

  window.addEventListener("DOMContentLoaded", () => {
    const appRoot = document.querySelector("#token-poker-app");
    if (appRoot) {
      initApp(appRoot);
    }

    const testOutput = document.querySelector("#test-output");
    if (testOutput) {
      runTests(testOutput).catch((error) => {
        testOutput.textContent = `FAIL Test runner error: ${error.message}`;
        testOutput.dataset.status = "failed";
      });
    }
  });
})();
