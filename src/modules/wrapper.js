
		var React = require("react");
		var textSplit = require("dsao/text-split");
		var markersMod = require("dsao/markers");
		var toolDiff = require("dsao/tool-diff");

		var _officialRendererCache = null;
		var _toolRendererCache = null;

		function findOfficialRenderer(slots) {
			if (_officialRendererCache) return _officialRendererCache;
			try {
				var entries = slots.entries("conversation.chat.node");
				if (!entries) return null;
				for (var i = 0; i < entries.length; i++) {
					var e = entries[i];
					if (e.options.key === "assistant-step" && (e.options.priority ?? 0) === 0) {
						_officialRendererCache = e.component;
						return _officialRendererCache;
					}
				}
			} catch (err) {}
			return null;
		}

		/**
		 * 官方 priority 0 entry 本体。遮蔽时不只是借它的 component：槽位把
		 * renderSlot 绑定到「当前 entry」并按该 entry 自己的 children 校验归属，
		 * 官方视图还会解构 entry inject 面（usePresentation / resolveFilePath /
		 * fileMentions / useTurnData ...）。缺任一项，官方组件渲染即抛，槽位边界
		 * 把我们的 entry 判为 abdicated 永久退役——折叠于是「时好时坏」。
		 */
		function findOfficialEntry(slots, key) {
			try {
				var entries = slots.entries("conversation.chat.node");
				if (!entries) return null;
				for (var i = 0; i < entries.length; i++) {
					var e = entries[i];
					if (e.options && e.options.key === key && (e.options.priority ?? 0) === 0) return e;
				}
			} catch (err) {}
			return null;
		}

		function findToolRenderer(slots) {
			if (_toolRendererCache) return _toolRendererCache;
			try {
				var entries = slots.entries("conversation.chat.node");
				if (!entries) return null;
				for (var i = 0; i < entries.length; i++) {
					var e = entries[i];
					if (e.options.key === "tool-call" && (e.options.priority ?? 0) === 0) {
						_toolRendererCache = e.component;
						return _toolRendererCache;
					}
				}
			} catch (err) {}
			return null;
		}

		/** 从 slots 查找 tool.call.toolview 官方 priority 0 组件 */
		function findOfficialView(slots, toolName) {
			try {
				var entries = slots.entries("tool.call.toolview");
				if (!entries) return null;
				for (var i = 0; i < entries.length; i++) {
					var e = entries[i];
					if (e.options.key === toolName && (e.options.priority || 0) === 0) return e.component;
				}
			} catch (err) {}
			return null;
		}

		/**
		 * 遮蔽官方 cell 时不能重复声明它的 children（register 会对已声明的子槽抛
		 * "already declared"），但官方组件仍会 renderSlot / renderSlotChain 去取
		 * 子槽内容，而这两个函数按「当前 entry.children」校验归属，调用即抛
		 * SlotOwnershipError。异常一旦逃到槽位边界，我们的 entry 就被 abdicate
		 * 永久退役、官方渲染器接管、原始 <think> 文本漏出。所以这里统一换成带兜底
		 * 的版本：先试原函数，失败则本地降级渲染，绝不让异常冒泡。
		 */
		function guardRenderSlot(fn) {
			return function (key, slotProps) {
				try {
					if (typeof fn === "function") return fn(key, slotProps);
				} catch (err) {}
				return fallbackSlotContent(key, slotProps);
			};
		}

		function fallbackSlotContent(key, p) {
			p = p || {};
			if (key === "conversation.chat.reasoning.body") {
				var text = p.text !== void 0 ? p.text : p.rawText;
				if (text === void 0 || String(text).trim() === "") return null;
				return React.createElement("div", { style: { whiteSpace: "pre-wrap" } }, String(text));
			}
			return null;
		}

		function guardRenderSlotChain(fn) {
			return function (key, owner, opts) {
				try {
					if (typeof fn === "function") return fn(key, owner, opts);
				} catch (err) {}
				return opts && "fallback" in opts ? opts.fallback : null;
			};
		}

		function WrappedAssistantStep(props) {
			var officialRenderer = props._officialRenderer;
			var ms = React.useState(markersMod.loadMarkers());
			var markers = ms[0];

			React.useEffect(function () {
				function handler() { ms[1](markersMod.loadMarkers()); }
				window.addEventListener("dsao:markers-changed", handler);
				return function () { window.removeEventListener("dsao:markers-changed", handler); };
			}, []);

			if (!officialRenderer) return null;
			var fp = Object.assign({}, props._rawProps || {});
			fp.renderSlot = guardRenderSlot(fp.renderSlot);
			fp.renderSlotChain = guardRenderSlotChain(fp.renderSlotChain);
			if (!markers || markers.length === 0) return React.createElement(officialRenderer, fp);
			var node = props.node;
			var data = node && node.data;
			if (!data || !data.blocks) return React.createElement(officialRenderer, fp);
			var hasText = false;
			for (var i = 0; i < data.blocks.length; i++) { if (data.blocks[i].kind === "text") { hasText = true; break; } }
			if (!hasText) return React.createElement(officialRenderer, fp);
			var newBlocks = textSplit.transformBlocks(data.blocks, markers);
			var newData = Object.assign({}, data, { blocks: newBlocks });
			var newNode = Object.assign({}, node, { data: newData });
			var newProps = Object.assign({}, fp, { node: newNode });
			return React.createElement(officialRenderer, newProps);
		}

		function WrappedToolCallRow(props) {
			var official = props._officialRenderer;
			var ref = React.useRef(null);
			var block = props.block;
			React.useEffect(function () {
				if (!ref.current) return;
				if (toolDiff.ensureBadge) toolDiff.ensureBadge(ref.current, block);
				var obs = new MutationObserver(function () {
					if (ref.current && toolDiff.ensureBadge) toolDiff.ensureBadge(ref.current, block);
				});
				obs.observe(ref.current, { childList: true, subtree: true });
				return function () { obs.disconnect(); };
			}, [block, official]);
			if (!official) return null;
			return React.createElement("div", { ref: ref, className: "dsao-tool-view-row", style: { display: "contents" } },
				React.createElement(official, props._rawProps || {})
			);
		}

		exports.WrappedAssistantStep = WrappedAssistantStep;
		exports.WrappedToolCallRow = WrappedToolCallRow;
		exports.findOfficialRenderer = findOfficialRenderer;
		exports.findOfficialEntry = findOfficialEntry;
		exports.findToolRenderer = findToolRenderer;
		exports.findOfficialView = findOfficialView;
