const SiBr3Configurator = (function() {

    // ═══════════════════════════════════════════════════════════════
    // STATE MANAGEMENT
    // ═══════════════════════════════════════════════════════════════
    const State = {
        lang: 'en',
        colorDefs: {},
		trioContext: { h: 0, s: 0 },
        leaderSelections: {},
        customColors: [],
        customRandomPool: [],
        playerColors: [],
        
        // Tool states
        eyedropper: null, // null | { active: true, copiedColor: { colorType, hex } | null }
        drag: null,       // { type: 'tile'|'jersey', leaderType, slot?, set? }
        colorPickerContext: { leaderType: null, slot: null },
        
        // Cache variables
        banner: { type: null, savedAt: null },
        paths: {
            currentConfigPath: '',
            currentSqlPath: '',
            currentDirPath: '',
            currentPastebinText: '',
            currentPastebinType: '' // 'sql' or 'config'
        }
    };
	
	// ═══════════════════════════════════════════════════════════════
    // UTILITIES & HELPERS
    // ═══════════════════════════════════════════════════════════════
    const Utils = {
        debounce: function(func, wait) {
            let timeout;
            return function(...args) {
                clearTimeout(timeout);
                timeout = setTimeout(() => func.apply(this, args), wait);
            };
        },
        escapeHtml: function(str) {
            return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        },
        triggerDownload: function(content, filename, mimeType) {
            const blob = new Blob([content], { type: mimeType });
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            a.href     = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }
    };

    // ═══════════════════════════════════════════════════════════════
    // LOCALISATION
    // ═══════════════════════════════════════════════════════════════
    function t(key, vars) {
        const str = (Locale.STRINGS[State.lang] && Locale.STRINGS[State.lang][key] !== undefined)
            ? Locale.STRINGS[State.lang][key]
            : (Locale.STRINGS['en'][key] !== undefined ? Locale.STRINGS['en'][key] : key);
        if (!vars) return str;
        return str.replace(/\{(\w+)\}/g, (_, k) => vars[k] !== undefined ? vars[k] : '{' + k + '}');
    }

    function tColor(type) {
        const block = Locale.STRINGS[State.lang] || Locale.STRINGS['en'];
        if (block.colorNames && block.colorNames[type] !== undefined) return block.colorNames[type];
        if (Locale.STRINGS['en'].colorNames && Locale.STRINGS['en'].colorNames[type] !== undefined) return Locale.STRINGS['en'].colorNames[type];
        return type;
    }

    function tLeader(type, fallback) {
        const block = Locale.STRINGS[State.lang] || Locale.STRINGS['en'];
        if (block.leaderNames && block.leaderNames[type] !== undefined) return block.leaderNames[type];
        return fallback;
    }

    function localeToLangKey(locale) {
        if (!locale) return null;
        const l = locale.toLowerCase().replace('_', '-');
        if (l.startsWith('zh-hant') || l === 'zh-tw' || l === 'zh-hk' || l === 'zh-mo') return 'zh_Hant';
        if (l.startsWith('zh')) return 'zh_Hans';
        if (l.startsWith('pt-br') || l.startsWith('pt_br')) return 'pt_BR';
        const base = l.split('-')[0];
        const map  = { en:'en', de:'de', fr:'fr', it:'it', es:'es', ja:'ja', ko:'ko', pl:'pl', ru:'ru' };
        return map[base] || null;
    }

    // ═══════════════════════════════════════════════════════════════
    // COLOR MATHS & LOGIC
    // ═══════════════════════════════════════════════════════════════
    const ColorUtils = {
        hslToHex: function(h, s, l) {
            l /= 100;
            const a = s * Math.min(l, 1 - l) / 100;
            const f = n => {
                const k = (n + h / 30) % 12;
                const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
                return Math.round(255 * color).toString(16).padStart(2, '0').toUpperCase();
            };
            return `#${f(0)}${f(8)}${f(4)}`;
        },
		hexToHSL: function(hex) {
            hex = hex.replace('#', '');
            const r = parseInt(hex.substr(0, 2), 16) / 255;
            const g = parseInt(hex.substr(2, 2), 16) / 255;
            const b = parseInt(hex.substr(4, 2), 16) / 255;
            const max = Math.max(r, g, b), min = Math.min(r, g, b);
            let h, s, l = (max + min) / 2;
            if (max === min) {
                h = s = 0; 
            } else {
                const d = max - min;
                s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
                switch (max) {
                    case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
                    case g: h = ((b - r) / d + 2) / 6; break;
                    case b: h = ((r - g) / d + 4) / 6; break;
                }
            }
            return { h: h * 360, s: s * 100, l: l * 100 };
        },
        
        hexToHue: function(hex) {
            const hsl = this.hexToHSL(hex);
            return hsl.s < 8 ? null : Math.round(hsl.h);
        },

        hexToRGBA255: function(hex) {
            const r = parseInt(hex.slice(1,3), 16);
            const g = parseInt(hex.slice(3,5), 16);
            const b = parseInt(hex.slice(5,7), 16);
            return `${r},${g},${b},255`;
        },

        getRelativeLuminosity: function(hex) {
            const r = parseInt(hex.slice(1, 3), 16) / 255;
            const g = parseInt(hex.slice(3, 5), 16) / 255;
            const b = parseInt(hex.slice(5, 7), 16) / 255;
            const toLinear = (c) => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
            return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
        },

        getContrastRatio: function(hex1, hex2) {
            const lum1 = this.getRelativeLuminosity(hex1);
            const lum2 = this.getRelativeLuminosity(hex2);
            const lighter = Math.max(lum1, lum2);
            const darker = Math.min(lum1, lum2);
            return (lighter + 0.05) / (darker + 0.05);
        },

        resolveColorHex: function(colorType) {
            if (State.colorDefs[colorType]) return State.colorDefs[colorType];
            const cc = State.customColors.find(c => c.id === colorType);
            return cc ? cc.hex : '#808080';
        },

        sortColorsByHue: function(colors, getHexFunc) {
            return colors.slice().sort((a, b) => {
                const hexA = getHexFunc(a);
                const hexB = getHexFunc(b);
                const hslA = this.hexToHSL(hexA);
                const hslB = this.hexToHSL(hexB);
                
                // 1. Neutral Detection
                // Catch grays (low saturation) AND pure blacks/whites (extreme lightness)
                const isNeutralA = hslA.s < 12 || hslA.l < 10 || hslA.l > 95;
                const isNeutralB = hslB.s < 12 || hslB.l < 10 || hslB.l > 95;
                
                if (isNeutralA && isNeutralB) {
                    // Sort neutrals smoothly from lightest (white) to darkest (black)
                    return hslB.l - hslA.l; 
                }
                if (isNeutralA) return 1;  // Push neutrals to the very end
                if (isNeutralB) return -1;
                
                // 2. Red Shift
                // Wrap pinks/crimsons back around to join the true reds
                const adjustedHueA = hslA.h > 340 ? hslA.h - 360 : hslA.h;
                const adjustedHueB = hslB.h > 340 ? hslB.h - 360 : hslB.h;
                
                // 3. Hue Bucketing
                // Group colors into 15-degree buckets
                const hueBucketA = Math.round(adjustedHueA / 15);
                const hueBucketB = Math.round(adjustedHueB / 15);
                
                if (hueBucketA !== hueBucketB) {
                    return hueBucketA - hueBucketB; // Primary sort: Rainbow order
                }
                
                // 4. Secondary Sort: Perceptual Luminance
                // Within the same hue bucket, create a smooth gradient from darkest to lightest.
                const lumA = this.getRelativeLuminosity(hexA);
                const lumB = this.getRelativeLuminosity(hexB);
                
                // If the luminance is nearly identical, tie-break with saturation 
                // so the more vibrant color sits first.
                if (Math.abs(lumA - lumB) < 0.02) {
                    return hslB.s - hslA.s;
                }
                
                return lumA - lumB; // Sort dark to light (use lumB - lumA for light to dark)
            });
        }
    };

    // ═══════════════════════════════════════════════════════════════
    // UI, MODALS & NOTIFICATIONS
    // ═══════════════════════════════════════════════════════════════
    const UI = {
        applyStrings: function() {
            document.title = t('appTitle');
            document.documentElement.lang = State.lang.replace('_', '-');
            document.getElementById('langDropdown').value = State.lang;
            document.getElementById('appTitle').textContent = t('appTitle');
            document.getElementById('appSubtitle').textContent = t('appSubtitle');
            document.getElementById('themeToggle').title = t('toggleTheme');
            document.getElementById('txtTabColors').innerHTML = t('tabColors');
            document.getElementById('txtTabLeaders').innerHTML = t('tabLeaders');

            // Re-label dynamic action buttons
			document.querySelectorAll('[data-action="exportWorkshopZip"]').forEach(el => { 
				el.innerHTML = `<img src="assets/icons/sib-cc-exportcolor.png" style="width: 20px; height: 20px; vertical-align: middle; margin-right: 6px;"> ` + t('btnExportMod')
			});
            document.querySelectorAll('[data-action="exportSql"]').forEach(el => { 
				el.innerHTML = `<img src="assets/icons/sib-cc-sql.png" style="width: 20px; height: 20px; vertical-align: middle; margin-right: 6px;"> ` + t('btnSaveApply')
			});
            document.querySelectorAll('[data-action="loadExternalMod"]').forEach(el => { 
				el.innerHTML = `<img src="assets/icons/sib-cc-steam.png" style="width: 20px; height: 20px; vertical-align: middle; margin-right: 6px;"> ` + (t('btnLoadExternalMod') || 'Import Mod (SQL/XML)')
			});
			document.querySelectorAll('[data-action="loadConfig"]').forEach(el => { 
				el.innerHTML = `<img src="assets/icons/sib-cc-folder-open.png" style="width: 20px; height: 20px; vertical-align: middle; margin-right: 6px;"> ` + t('btnLoadConfig')
			});
            document.querySelectorAll('[data-action="exportConfig"]').forEach(el => { 
				el.innerHTML = `<img src="assets/icons/sib-cc-save.png" style="width: 20px; height: 20px; vertical-align: middle; margin-right: 6px;"> ` + t('btnExportConfig')
			});
            document.querySelectorAll('[data-action="resetLeaders"], [data-action="resetColors"]').forEach(el => {
				el.innerHTML = `<img src="assets/icons/sib-cc-history.png" style="width: 20px; height: 20px; vertical-align: middle; margin-right: 6px;"> ` + t('btnResetAssign');
			});
			document.querySelectorAll('[data-action="resetColors"]').forEach(el => {
				el.innerHTML = `<img src="assets/icons/sib-cc-history.png" style="width: 20px; height: 20px; vertical-align: middle; margin-right: 6px;"> ` + t('btnResetDefs');
			});
            
            const bulkAutoBtn = document.getElementById('txtBtnBulkAuto');
            if (bulkAutoBtn) bulkAutoBtn.innerHTML = t('btnAutoColorAll');
            
            // Modals & Static Text
            document.getElementById('footerCredit').textContent = t('footerCredit', { version: Config.VERSION });
            document.getElementById('footerNote').textContent = t('footerNote');
            
			document.getElementById('tabUtilitiesL').textContent = t('tabUtilities');
			document.getElementById('tabUtilitiesC').textContent = t('tabUtilities');
            
            document.getElementById('colorPickerTitle').textContent = t('modalColorPickerTitle');
            const quickColorLabel = document.getElementById('quickColorModeLabel');
            if (quickColorLabel && document.getElementById('quickColorEditMode').value === 'add') {
                quickColorLabel.textContent = t('labelQuickAddColor');
            }
            document.getElementById('quickColorName').placeholder = t('placeholderQuickColorName');
            document.getElementById('quickColorPicker').title = t('tipColorPicker');
            const quickBtn = document.getElementById('quickColorBtn');
            if (quickBtn && document.getElementById('quickColorEditMode').value === 'add') {
                quickBtn.innerHTML = `<img src="assets/icons/sib-cc-addcolor.png" style="width: 20px; height: 20px; vertical-align: middle;"> `;
            }
            document.getElementById('quickColorCancelBtn').innerHTML = `<img src="assets/icons/sib-cc-cancel.png" style="width: 20px; height: 20px; vertical-align: middle;"> `;
            
            document.getElementById('customRandomPoolTitle').textContent = t('modalCustomPoolTitle');
            document.getElementById('customPoolDesc').textContent = t('modalCustomPoolDesc');
            document.getElementById('btnClearCustomPool').textContent = t('btnClearAll');
            
            const btnApplyCustom = document.getElementById('applyCustomPoolBtn');
            if(btnApplyCustom) {
                const count = State.customRandomPool.length;
                const raw = t('btnApplyCount', { count: count });
                const parts = raw.split('|');
                btnApplyCustom.textContent = (count === 1 && parts.length > 1) ? parts[0] : (parts.length > 1 ? parts[1] : parts[0]);
            }
            
            document.getElementById('bulkAutoModalTitle').textContent = t('modalBulkAutoTitle');
            document.getElementById('bulkAutoDesc').textContent = t('modalBulkAutoDesc');
            document.getElementById('eyedropperLabel').textContent = State.eyedropper ? t('eyedropperActive') : t('eyedropperCopy');
            document.getElementById('genericPastebinTitle').textContent = t('sqlPastebinTitle');
			document.getElementById('genericCopyStatus').innerHTML = `<img src="assets/icons/sib-cc-tick.png" style="width: 20px; height: 20px; vertical-align: middle;">`;
			
            
			// Trio Modal Localisation
            
            document.getElementById('trioModalTitle').textContent = t('modalTrioTitle');
            document.getElementById('lblTrioBaseName').textContent = t('labelBaseName');
			document.getElementById('trioBaseName').placeholder = t('labelPlaceholderBaseName');
            document.getElementById('lblTrioBaseHex').textContent = t('labelBaseHex');
            document.getElementById('lblTrioBasePos').textContent = t('labelBasePosition');
            document.getElementById('lblTrioGen').textContent = t('labelGeneratedTrio');
            
            document.getElementById('txtTrioPosLT').textContent = t('labelPosLight');
            document.getElementById('txtTrioRowLT').textContent = t('labelPosLight');
            document.getElementById('txtTrioPosMD').textContent = t('labelPosMedium');
            document.getElementById('txtTrioRowMD').textContent = t('labelPosMedium');
            document.getElementById('txtTrioPosDK').textContent = t('labelPosDark');
            document.getElementById('txtTrioRowDK').textContent = t('labelPosDark');
            document.getElementById('btnSaveTrio').textContent = t('btnSaveTrio');
			// Mod import/export
						// Export
						document.getElementById('exportWorkshopModalBodyDescription_top').textContent = t('exportWorkshopModalBodyDescription_top');
						document.getElementById('exportWorkshopModalBodyDescription_path').textContent = t('exportWorkshopModalBodyDescription_path');
						document.getElementById('exportWorkshopModalBodyDescription_bottom').textContent = t('exportWorkshopModalBodyDescription_bottom');
						document.getElementById('exportWorkshopModalBodyModDetails').textContent = t('exportWorkshopModalBodyModDetails');
						document.getElementById('exportWorkshopModalBodyModDetails_name').textContent = t('exportWorkshopModalBodyModDetails_name');
						document.getElementById('exportWorkshopModalBodyModDetails_id').textContent = t('exportWorkshopModalBodyModDetails_id');
						document.getElementById('exportWorkshopModalBodyModDetails_id_subtitle').textContent = t('exportWorkshopModalBodyModDetails_id_subtitle');
						document.getElementById('exportWorkshopModalBodyModDetails_author').textContent = t('exportWorkshopModalBodyModDetails_author');
						document.getElementById('exportWorkshopModalBodyModDetails_version').textContent = t('exportWorkshopModalBodyModDetails_version');
						document.getElementById('exportWorkshopModalBodyModDetails_version_subtitle').textContent = t('exportWorkshopModalBodyModDetails_version_subtitle');
						// Buttons
						document.getElementById('btnCancelWorkshopExport').textContent = t('btnCancel');
						document.getElementById('btnConfirmWorkshopExport').textContent = t('btnConfirmWorkshopExport');
						
						//Import
						document.getElementById('advancedImportModal_title').textContent = t('advancedImportModal_title');
						document.getElementById('advancedImportModal_source').textContent = t('advancedImportModal_source');
						document.getElementById('advancedImportModal_selection').textContent = t('advancedImportModal_selection');
						document.getElementById('advancedImportModal_merge_head').textContent = t('advancedImportModal_merge_head');
						document.getElementById('advancedImportModal_merge_body').textContent = t('advancedImportModal_merge_body');
						document.getElementById('advancedImportModal_replace_head').textContent = t('advancedImportModal_replace_head');
						document.getElementById('advancedImportModal_replace_body').textContent = t('advancedImportModal_replace_body');
						
						document.getElementById('btnCancelAdvancedImport').textContent = t('btnCancel');
						document.getElementById('btnConfirmAdvancedImport').textContent = t('btnConfirmAdvancedImport');
						
			//Loading
			
			document.getElementById('btnLoadingModalCancel').textContent = t('btnCancel');
			

            
            Render.colorsTable();
            Render.leadersTable();
            if (document.getElementById('colorPickerModal').classList.contains('active')) Render.colorPicker();
            if (document.getElementById('customRandomPoolModal').classList.contains('active')) Render.customPoolPicker(document.getElementById('customRandomPoolModal').dataset.leaderType, document.getElementById('customRandomPoolModal').dataset.isBulk === 'true');

			// Redraw the session banner in the new language
            if (State.banner && State.banner.type) {
                this.showSessionBanner(State.banner.type, State.banner.savedAt); 
            }
		},

        notify: function(message, type = 'info') {
            const tray = document.getElementById('notificationTray');
            const existing = tray.querySelectorAll('.notif');
            if (existing.length >= 5) this.removeNotification(existing[0]);
            
            const notif = document.createElement('div');
            notif.className = `notif notif-${type}`;
			if (notif.className == 'notif notif-error') {
				notif.innerHTML = `<img src="assets/icons/sib-cc-error.png" style="width: 32px; height: 32px; margin-right: 6px;"><span class="notif-body">${message}</span><button class="notif-dismiss" title="Dismiss">&#215;</button>`;
           } else {
				notif.innerHTML = `<img src="assets/icons/sib-cc-notify.png" style="width: 32px; height: 32px; margin-right: 6px;"><span class="notif-body">${message}</span><button class="notif-dismiss" title="Dismiss">&#215;</button>`;
			};
            notif.querySelector('.notif-dismiss').addEventListener('click', () => this.removeNotification(notif));
            tray.appendChild(notif);
            setTimeout(() => { if (notif.parentNode) this.removeNotification(notif); }, 4000);
        },
        
        removeNotification: function(notifElement) {
            notifElement.classList.add('hiding');
            setTimeout(() => { if (notifElement.parentNode) notifElement.remove(); }, 300);
        },

        openModal: function(modalId) {
            const modal = document.getElementById(modalId);
            if (modal) modal.classList.add('active');
        },

        closeModal: function(modalId) {
            const modal = document.getElementById(modalId);
            if (modal) modal.classList.remove('active');
        },
		
		confirm: function(message, onConfirm) {
            // Split the incoming message at the first newline character
            const parts = message.split('\n');
            
            // Format the first line as bold and slightly larger/brighter
            let formattedText = `<strong style="color: var(--text-primary); font-size: 10pt;">${parts[0]}</strong>`;
            
            // If there is a second line, keep it normal weight and softer color
            if (parts.length > 1) {
                formattedText += `\n<span style="font-weight: normal; font-size: 9pt; color: var(--text-primary);">${parts.slice(1).join('\n')}</span>`;
            }
            
            // Inject using innerHTML so the <strong> and <span> tags render correctly
            document.getElementById('confirmModalText').innerHTML = formattedText;
            
            // Translate the static buttons (optional, defaults to English)
            //document.getElementById('confirmModalTitle').textContent = t('modalConfirmTitle', 'Are you sure?');
            document.getElementById('btnConfirmCancel').textContent = t('btnCancel', 'Cancel');
            document.getElementById('btnConfirmYes').textContent = t('btnConfirm', 'Yes');

            const btnYes = document.getElementById('btnConfirmYes');
            
            // Overwrite the click handler so it only runs the specific action requested
            btnYes.onclick = () => {
                this.closeModal('confirmModal');
                onConfirm();
            };
            
            this.openModal('confirmModal');
        },
		
		showPastebin: function(title, content, footerText, downloadName) {
            State.paths.currentPastebinText = content;
            State.paths.currentPastebinType = 'sql'; // Hardcoded since JSON has its own direct download now
            
            document.getElementById('genericPastebinTitle').textContent = title;
            document.getElementById('genericCopyBtnLabel').textContent = t('sqlCopyBtn');
            document.getElementById('genericCopyStatus').classList.remove('visible');
            
            const lines = content.split('\n');
            document.getElementById('genericLineNumbers').innerHTML = lines.map((_, i) => `<span>${i + 1}</span>`).join('');
            
            // Exclusively SQL syntax highlighting
            const codeHtml = lines.map(line => {
                let safe = Utils.escapeHtml(line);
                if (/^\s*--/.test(safe)) return `<span class="sql-cmt">${safe}</span>`;
                safe = safe.replace(/\b(UPDATE|SET|WHERE|INSERT|INTO|VALUES|OR|REPLACE|AND|FROM|SELECT|DELETE|CREATE|ALTER|DROP|TABLE|INDEX|NOT|NULL|DEFAULT|PRIMARY|KEY|UNIQUE|CHECK|FOREIGN|REFERENCES|IN|IS|LIKE|BETWEEN|EXISTS|CASE|WHEN|THEN|ELSE|END|AS|ON|JOIN|LEFT|RIGHT|INNER|OUTER|GROUP|ORDER|BY|HAVING|LIMIT|OFFSET|UNION|ALL|DISTINCT|COUNT|SUM|AVG|MIN|MAX)\b/g, '<span class="sql-kw">$1</span>');
                safe = safe.replace(/'([^']*)'/g, "'<span class=\"sql-str\">$1</span>'");
                return safe;
            }).join('\n');
            
            document.getElementById('genericCodeBody').innerHTML = codeHtml;
            
            // Footer: plain instructional text
            document.getElementById('genericPastebinFooter').textContent = footerText;
            
            // Hardcoded to text/plain for SQL and specific SQL tooltip
            const dlBtn = document.getElementById('btnGenericPastebinDownload');
            dlBtn.onclick = () => Utils.triggerDownload(content, downloadName, 'text/plain;charset=utf-8');
            dlBtn.title = t('tipDownloadSql');
        
            const lingerWeight = 15; 

           const baseSteps = [
                ...Array(lingerWeight).fill(`${t('tabColors')} - ${t('labelCustomColorSection')}`),
                ...Array(lingerWeight).fill(`${t('tabColors')} - ${t('labelSibreColorSection')}`),
                ...Array(lingerWeight).fill(`${t('tabColors')} - ${t('labelStandardColorSection')}`)
            ];
                
            const leaderSteps = Config.DEFAULT_LEADERS.map(l => 
                `${t('tabLeaders')} - ${tLeader(l.type, l.name)}` 
            );
            
            const processingSteps = [...baseSteps, ...leaderSteps];
            
            Theater.simulateLoading(t('titleCompilingExport'), 'assets/icons/sib-cc-compile.png' , processingSteps, 0, () => {
                this.openModal('genericPastebinModal');
            });
        },

        showSessionBanner: function(type, savedAt) {
            State.banner.type = type;
            State.banner.savedAt = savedAt !== undefined ? savedAt : State.banner.savedAt;
            const banner = document.getElementById('sessionBanner');
            
            banner.className = type;

            if (type === 'warn') {
                banner.querySelector('.banner-icon').innerHTML = `<img src="assets/icons/sib-cc-warning.png" style="width: 32px; height: 32px;">`;
                
                banner.querySelector('.banner-text').innerHTML = `
                    <strong data-i18n="bannerWarnTitle">${t('bannerWarnTitle')}</strong>
                    <span data-i18n="bannerWarnBody">${t('bannerWarnBody')}</span>
                `;
                
                document.getElementById('bannerLoadBtn').style.display = '';
            } else {
                // Force the Date object to use current language
                const activeLocale = State.currentLanguage || 'en'; 
                const formattedTime = new Date(State.banner.savedAt).toLocaleString(activeLocale);
                
                const when = State.banner.savedAt ? ` (${t('lastSaved', { time: formattedTime })})` : '';
                
                banner.querySelector('.banner-icon').innerHTML = `<img src="assets/icons/sib-cc-restore.png" style="width: 32px; height: 32px;">`;
                banner.querySelector('.banner-text').innerHTML = `<strong>${t('bannerOkTitle')}${when}.</strong> ${t('bannerOkBody')}`;
                
                document.getElementById('bannerLoadBtn').style.display = 'none';
            }
        }
    };
	
	document.addEventListener('mousemove', (e) => {
		const watchCursor = document.getElementById('theaterWatchCursor');
		
		// Only run this logic if the Theater is currently active
		if (watchCursor && watchCursor.style.display === 'block') {
			
			// Keep tracking the coordinates
			watchCursor.style.left = e.clientX + 'px';
			watchCursor.style.top = e.clientY + 'px';

			// Detect if the user is hovering over a button, link, or close box
			const isClickable = e.target.closest('button, a, .modal-close-box');

			if (isClickable) {
				watchCursor.style.visibility = 'hidden';
				document.body.style.cursor = ''; 
			} else {
				watchCursor.style.visibility = 'visible';
				document.body.style.cursor = 'none'; 
			}
		}
	});
	
    // ═══════════════════════════════════════════════════════════════
    // PATH DETECTION & PERSISTENCE
    // ═══════════════════════════════════════════════════════════════
    function getModDirectory() {
        // Auto-detection from file:/// URLs is no longer supported.
        // Returns a manually set path if one exists, otherwise null.
        return State.paths.currentDirPath || null;
    }

    function persist() {
        const darkMode = document.documentElement.hasAttribute('data-dark');
        const savedAt  = new Date().toISOString();
        localStorage.setItem('sib-color-configurator', JSON.stringify({ 
            colorDefs: State.colorDefs, 
            leaderSelections: State.leaderSelections, 
            customColors: State.customColors,
            customRandomPool: State.customRandomPool,
            darkMode, 
            savedAt
        }));
    }
	
	// ═══════════════════════════════════════════════════════════════
    // AUTO-GENERATION LOGIC
    // ═══════════════════════════════════════════════════════════════
    const AutoGen = {
        
        getGlobalExistingPairs: function(excludeLeaderType = null) {
            const pairs = { main: [], alt1: [], alt2: [], alt3: [] };
            for (const leader of Config.DEFAULT_LEADERS) {
                if (excludeLeaderType && leader.type === excludeLeaderType) continue;
                const sel = State.leaderSelections[leader.type];
                if (!sel) continue;
                if (sel.primary && sel.secondary) pairs.main.push([sel.primary, sel.secondary]);
                if (sel.alt1Primary && sel.alt1Secondary) pairs.alt1.push([sel.alt1Primary, sel.alt1Secondary]);
                if (sel.alt2Primary && sel.alt2Secondary) pairs.alt2.push([sel.alt2Primary, sel.alt2Secondary]);
                if (sel.alt3Primary && sel.alt3Secondary) pairs.alt3.push([sel.alt3Primary, sel.alt3Secondary]);
            }
            return pairs;
        },

        // Checks if two single colors are visually "too similar"
        isColorSimilar: function(c1, c2) {
            if (c1 === c2) return true;
            
            // 1. Text-based heuristic for system colors (Strips _DK, _MD, _LT, _MD2)
            const getBase = c => {
                const m = c.match(/^(COLOR_.*)_(DK|MD|LT|MD2)$/i);
                return m ? m[1] : c;
            };
            const base1 = getBase(c1), base2 = getBase(c2);
            // If they both have valid suffixes and share the same base, flag as similar
            if (base1 !== c1 && base2 !== c2 && base1 === base2) return true;

            // 2. Maths-based fallback (Redmean algorithm for perceptual RGB distance)
            const hex1 = ColorUtils.resolveColorHex(c1);
            const hex2 = ColorUtils.resolveColorHex(c2);
            
            const r1 = parseInt(hex1.slice(1,3), 16), g1 = parseInt(hex1.slice(3,5), 16), b1 = parseInt(hex1.slice(5,7), 16);
            const r2 = parseInt(hex2.slice(1,3), 16), g2 = parseInt(hex2.slice(3,5), 16), b2 = parseInt(hex2.slice(5,7), 16);
            
            const rmean = (r1 + r2) / 2;
            const r = r1 - r2, g = g1 - g2, b = b1 - b2;
            
            // Weighted distance prioritising human eye sensitivity
            const dist = Math.sqrt((2 + rmean/256)*r*r + 4*g*g + (2 + (255-rmean)/256)*b*b);
            
            // A distance under 45 is roughly indistinguishable at a glance
            return dist < 45; 
        },

        // Checks if a Primary/Secondary pair is too similar to any existing pair
        isPairDuplicate: function(p1, s1, existingPairs) {
            return existingPairs.some(pair => {
                const [ep, es] = pair;
                // Check both standard assignment and swapped assignment (P=S, S=P)
                const directMatch = this.isColorSimilar(p1, ep) && this.isColorSimilar(s1, es);
                const swappedMatch = this.isColorSimilar(p1, es) && this.isColorSimilar(s1, ep);
                return directMatch || swappedMatch;
            });
        },

        getContrastingColor: function(pool, avoidColor, existingPairs = []) {
            // Immediately strip out colours that are too similar to the Primary color
            const candidates = pool.filter(c => !this.isColorSimilar(c, avoidColor));
            if (!candidates.length) return avoidColor; // Extreme fallback
            
            const avoidHex = ColorUtils.resolveColorHex(avoidColor);
            
            // Score candidates based on Contrast and filter out those that create duplicate pairs
            const valid = candidates
                .map(color => ({ 
                    color, 
                    contrast: ColorUtils.getContrastRatio(avoidHex, ColorUtils.resolveColorHex(color)),
                    isDupe: this.isPairDuplicate(avoidColor, color, existingPairs)
                }))
                .filter(item => !item.isDupe)
                .sort((a, b) => b.contrast - a.contrast);
                
            if (valid.length > 0) {
                // If we have highly contrasting valid colors (>4.0), pick one of the best randomly
                const highContrast = valid.filter(v => v.contrast >= 4.0);
                const selectionPool = highContrast.length > 0 ? highContrast : valid.slice(0, 3);
                
                // Weight selection towards the higher contrast options
                const weights = selectionPool.map((_, i) => Math.pow(0.85, i));
                let random = Math.random() * weights.reduce((a, b) => a + b, 0);
                for (let i = 0; i < weights.length; i++) {
                    random -= weights[i];
                    if (random <= 0) return selectionPool[i].color;
                }
                return selectionPool[0].color;
            }
            
            // Absolute worst-case fallback: Every single highly-contrasting color creates a duplicate pair. 
            // Edge case >> ignore the duplicate rule to ensure the jersey is at least readable.
            const fallbacks = candidates
                .map(color => ({ color, contrast: ColorUtils.getContrastRatio(avoidHex, ColorUtils.resolveColorHex(color)) }))
                .sort((a,b) => b.contrast - a.contrast);
            return fallbacks[0].color;
        },

        generateRandomAll: function(leaderType, globalPairs = null) {
            const allColors = [...Config.DEFAULT_COLORS.map(c=>c.type), ...Config.SIBR3_COLORS.map(c=>c.type), ...State.customColors.map(c=>c.id)];
            return this._generateFromPool(allColors, leaderType, globalPairs);
        },

        generateCurated: function(leaderType, globalPairs = null) {
            const pool = Config.CURATED_COLORS[leaderType];
            if (!pool || pool.length < 2) return this.generateRandomAll(leaderType, globalPairs);
            return this._generateFromPool(pool, leaderType, globalPairs);
        },

        generateCustom: function(leaderType, globalPairs = null) {
            if (State.customRandomPool.length < 2) return null;
            return this._generateFromPool(State.customRandomPool, leaderType, globalPairs);
        },
        
        generateAltsFrom: function(primary, secondary) {
            const pool = [primary, secondary, ...Config.DEFAULT_COLORS.map(c=>c.type).slice(0, 10)];
            return this._generateFromPool(pool, null, { main:[], alt1:[], alt2:[], alt3:[] });
        },

        _generateFromPool: function(pool, leaderType, globalPairs) {
            const gPairs = globalPairs || (leaderType ? this.getGlobalExistingPairs(leaderType) : { main:[], alt1:[], alt2:[], alt3:[] });
            const localPairs = []; 
            const result = {};
            const slots = [
                {p:'primary', s:'secondary', g:'main'}, 
                {p:'alt1Primary', s:'alt1Secondary', g:'alt1'}, 
                {p:'alt2Primary', s:'alt2Secondary', g:'alt2'}, 
                {p:'alt3Primary', s:'alt3Secondary', g:'alt3'}
            ];
            
            slots.forEach(slot => {
                // Pick a primary colour, trying to avoid making the primary the exact same as another alt's primary
                let pColor = pool[Math.floor(Math.random() * pool.length)];
                let attempts = 0;
                while (localPairs.some(pair => this.isColorSimilar(pair[0], pColor)) && attempts < 15) {
                    pColor = pool[Math.floor(Math.random() * pool.length)];
                    attempts++;
                }
                
                result[slot.p] = pColor;
                
                // Get secondary, passing both the leader's generated pairs and the global pairs for this slot
                result[slot.s] = this.getContrastingColor(pool, result[slot.p], [...localPairs, ...gPairs[slot.g]]);
                
                localPairs.push([result[slot.p], result[slot.s]]);
            });
            return result;
        }
    };

    // ═══════════════════════════════════════════════════════════════
    // EXTERNAL IMPORT (SQL/XML)
    // ═══════════════════════════════════════════════════════════════
    const ExternalImport = {
        parseSQL: function(content) {
            const results = { colors: {}, leaders: {} };

            // Sanitize: Remove SQL comments
            const cleanContent = content.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

            // Parse Colors (UPDATE syntax)
            const colorUpdateRegex = /UPDATE\s+Colors\s+SET\s+Color\s*=\s*(['"])(.*?)\1[^;]+WHERE\s+Type\s*=\s*(['"])(.*?)\3/gi;
            let match;
            while ((match = colorUpdateRegex.exec(cleanContent)) !== null) {
                results.colors[match[4]] = this._rgbaToHex(match[2]);
            }

            // Parse Colors (INSERT syntax) - Now accounts for missing semicolons at EOF
            const colorInsertRegex = /(?:INSERT|REPLACE)\s+(?:OR\s+REPLACE\s+)?INTO\s+Colors\s*\([^)]*\)\s*VALUES\s*([\s\S]*?)(?=;|(?:INSERT|REPLACE|UPDATE|DELETE|CREATE)\s|$)/gi;
            while ((match = colorInsertRegex.exec(cleanContent)) !== null) {
                const valuesBlock = match[1];
                const tupleRegex = /\(\s*(['"])(.*?)\1\s*,\s*(['"])(.*?)\3/g;
                let tupleMatch;
                while ((tupleMatch = tupleRegex.exec(valuesBlock)) !== null) {
                    results.colors[tupleMatch[2]] = this._rgbaToHex(tupleMatch[4]);
                }
            }

            // Parse Leaders (UPDATE syntax) - Added LeaderType as a fallback for typos
            const leaderUpdateRegex = /UPDATE\s+PlayerColors\s+SET\s+([\s\S]*?)\s+WHERE\s+(?:Type|LeaderType)\s*=\s*(['"])(.*?)\2/gi;
            while ((match = leaderUpdateRegex.exec(cleanContent)) !== null) {
                const leaderType = match[3];
                const setString = match[1];
                const extractedProps = this._extractLeaderColorsSQL(setString);

                if (!results.leaders[leaderType]) results.leaders[leaderType] = {};
                Object.assign(results.leaders[leaderType], extractedProps);
            }

            // Parse Leaders (INSERT syntax) - Now accounts for missing semicolons at EOF
            const leaderInsertRegex = /(?:INSERT|REPLACE)\s+(?:OR\s+REPLACE\s+)?INTO\s+PlayerColors\s*\(([^)]+)\)\s*VALUES\s*([\s\S]*?)(?=;|(?:INSERT|REPLACE|UPDATE|DELETE|CREATE)\s|$)/gi;
            while ((match = leaderInsertRegex.exec(cleanContent)) !== null) {
                const columns = match[1].split(',').map(c => c.trim().replace(/['"]/g, ''));
                const valuesBlock = match[2];

                const tupleRegex = /\(([^)]+)\)/g;
                let tupleMatch;
                while ((tupleMatch = tupleRegex.exec(valuesBlock)) !== null) {
                    const values = tupleMatch[1].split(',').map(v => v.trim().replace(/['"]/g, ''));
                    const props = {};
                    let leaderType = null;

                    columns.forEach((col, idx) => {
                        const val = values[idx];
                        if (col === 'Type' || col === 'LeaderType') {
                            leaderType = val;
                        } else {
                            const mappedKey = this._mapPlayerColorKey(col);
                            if (mappedKey && val && val.toUpperCase() !== 'NULL') {
                                props[mappedKey] = val;
                            }
                        }
                    });

                    if (leaderType) {
                        if (!results.leaders[leaderType]) results.leaders[leaderType] = {};
                        Object.assign(results.leaders[leaderType], props);
                    }
                }
            }

            return results;
        },

        parseXML: function(content) {
            const results = { colors: {}, leaders: {} };
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(content, "text/xml");
            
            const colorUpdates = xmlDoc.querySelectorAll('Colors Update');
            colorUpdates.forEach(node => {
                const where = node.querySelector('Where');
                const set = node.querySelector('Set');
                if (where && set) {
                    const type = where.getAttribute('Type');
                    const color = set.getAttribute('Color');
                    if (type && color) results.colors[type] = this._rgbaToHex(color);
                }
            });
            
            const colorReplaces = xmlDoc.querySelectorAll('Colors Replace, Colors Row');
            colorReplaces.forEach(node => {
                const type = node.getAttribute('Type');
                const color = node.getAttribute('Color');
                if (type && color) results.colors[type] = this._rgbaToHex(color);
            });
            
            const leaderUpdates = xmlDoc.querySelectorAll('PlayerColors Update');
            leaderUpdates.forEach(node => {
                const where = node.querySelector('Where');
                const set = node.querySelector('Set');
                if (where && set) {
                    const type = where.getAttribute('Type');
                    if (type) {
                        const props = {};
                        Array.from(set.attributes).forEach(attr => {
                            const mappedKey = this._mapPlayerColorKey(attr.name);
                            if (mappedKey) props[mappedKey] = attr.value;
                        });

                        if (Object.keys(props).length > 0) {
                            results.leaders[type] = props;
                        }
                    }
                }
            });
            
            return results;
        },

        collapseDuplicates: function(parsedData) {
            const hexMap = {}; // Maps uppercase hex -> chosen color ID
            const finalColors = {};
            const colorAlias = {}; // Maps original color ID -> chosen color ID

            // 1. Identify duplicates and build aliases
            for (const [colorId, hex] of Object.entries(parsedData.colors)) {
                const upperHex = hex.toUpperCase();
                if (!hexMap[upperHex]) {
                    hexMap[upperHex] = colorId;
                    finalColors[colorId] = upperHex;
                    colorAlias[colorId] = colorId; // Self-alias
                } else {
                    colorAlias[colorId] = hexMap[upperHex]; // Alias duplicate to the original
                }
            }

            parsedData.colors = finalColors;

            // 2. Remap leader assignments to use the collapsed alias
            for (const [leaderType, props] of Object.entries(parsedData.leaders)) {
                for (const [slot, colorId] of Object.entries(props)) {
                    if (colorAlias[colorId]) {
                        props[slot] = colorAlias[colorId];
                    }
                }
            }

            return parsedData;
        },

        applyParsedData: function(results) {
            if (results.colors) {
                Object.keys(results.colors).forEach(type => {
                    const hex = results.colors[type];
                    if (!hex) return;
                    
                    const isStandard = Config.DEFAULT_COLORS.find(c => c.type === type) || Config.SIBR3_COLORS.find(c => c.type === type);
                    
                    if (isStandard) {
                        State.colorDefs[type] = hex;
                    } else {
                        const existingCustom = State.customColors.find(c => c.id === type);
                        if (existingCustom) {
                            existingCustom.hex = hex;
                        } else {
                            State.customColors.push({ id: type, name: type, hex: hex });
                        }
                    }
                });
            }
            
            if (results.leaders) {
                Object.keys(results.leaders).forEach(type => {
                    if (State.leaderSelections[type]) {
                        Object.assign(State.leaderSelections[type], results.leaders[type]);
                    }
                });
            }
        },

        _rgbaToHex: function(rgbaStr) {
            const parts = rgbaStr.split(',').map(s => parseInt(s.trim(), 10));
            if (parts.length >= 3) {
                const r = parts[0].toString(16).padStart(2, '0');
                const g = parts[1].toString(16).padStart(2, '0');
                const b = parts[2].toString(16).padStart(2, '0');
                return `#${r}${g}${b}`.toUpperCase();
            }
            return null;
        },

        _mapPlayerColorKey: function(key) {
            const map = {
                'PrimaryColor': 'primary', 'SecondaryColor': 'secondary',
                'Alt1PrimaryColor': 'alt1Primary', 'Alt1SecondaryColor': 'alt1Secondary',
                'Alt2PrimaryColor': 'alt2Primary', 'Alt2SecondaryColor': 'alt2Secondary',
                'Alt3PrimaryColor': 'alt3Primary', 'Alt3SecondaryColor': 'alt3Secondary'
            };
            return map[key] || null;
        },

        _extractLeaderColorsSQL: function(setString) {
            const props = {};
            const assignments = setString.split(',');
            assignments.forEach(assign => {
                const parts = assign.split('=');
                if (parts.length === 2) {
                    const key = parts[0].trim();
                    const val = parts[1].trim().replace(/['"]/g, ''); 
                    const mappedKey = this._mapPlayerColorKey(key);
                    if (mappedKey) {
                        props[mappedKey] = val;
                    }
                }
            });
            return props;
        }
    };
	
	const ImportStaging = {
        currentData: { colors: {}, leaders: {} },

        render: function(parsedData) {
            this.currentData = parsedData;
            const colorsContainer = document.getElementById('importStagingColors');
            const leadersContainer = document.getElementById('importStagingLeaders');
            
            const colorKeys = Object.keys(parsedData.colors);
            const leaderKeys = Object.keys(parsedData.leaders);

            document.getElementById('stagingColorCount').textContent = colorKeys.length;
            document.getElementById('stagingLeaderCount').textContent = leaderKeys.length;

            // Render Colors
            colorsContainer.innerHTML = colorKeys.map(c => `
                <div class="staging-item" style="display: flex; align-items: center; margin-bottom: 4px;">
                    <input type="checkbox" class="staging-cb staging-color-cb" value="${c}" id="stg_c_${c}" checked style="margin-right: 8px; cursor: pointer;">
                    <div style="width: 16px; height: 16px; background: ${parsedData.colors[c]}; border: 1px solid var(--border); border-radius: 2px; margin-right: 8px;"></div>
                    <label for="stg_c_${c}" style="font-size: 13px; cursor: pointer; flex: 1; word-break: break-all;">${c}</label>
                </div>
            `).join('') || '<div style="color: var(--text-muted); font-style: italic;">No colors found.</div>';

            // Render Leaders
            leadersContainer.innerHTML = leaderKeys.map(l => `
                <div class="staging-item" style="display: flex; align-items: center; margin-bottom: 4px;">
                    <input type="checkbox" class="staging-cb staging-leader-cb" value="${l}" id="stg_l_${l}" checked style="margin-right: 8px; cursor: pointer;">
                    <label for="stg_l_${l}" style="font-size: 13px; cursor: pointer; flex: 1; word-break: break-all;">${l}</label>
                </div>
            `).join('') || '<div style="color: var(--text-muted); font-style: italic;">No leaders found.</div>';

            document.getElementById('importStagingArea').style.display = 'block';
            document.getElementById('btnConfirmAdvancedImport').disabled = (colorKeys.length === 0 && leaderKeys.length === 0);
            
            this.evaluateDependencies();
        },

        evaluateDependencies: function() {
            const warningEl = document.getElementById('importDependencyWarning');
            const confirmBtn = document.getElementById('btnConfirmAdvancedImport');
            const mode = document.querySelector('input[name="importMode"]:checked').value;
            
            let missingColors = new Set();
            const checkedLeaders = Array.from(document.querySelectorAll('.staging-leader-cb:checked')).map(cb => cb.value);
            const checkedColors = new Set(Array.from(document.querySelectorAll('.staging-color-cb:checked')).map(cb => cb.value));

            // Generate a set of all safe colors based on the import mode
            let safeColors = new Set(checkedColors);
            
            // Standard and Sibr3 colors are ALWAYS safe, regardless of import mode
            if (typeof Config !== 'undefined') {
                Config.DEFAULT_COLORS.forEach(c => safeColors.add(c.type));
                Config.SIBR3_COLORS.forEach(c => safeColors.add(c.type));
            }

            if (mode === 'merge') {
                // If merging, existing custom colors in the app are also safe
                State.customColors.forEach(c => safeColors.add(c.id));
                Object.keys(State.colorDefs).forEach(c => safeColors.add(c));
            }

            // Check if any checked leader requires a color that isn't in the safe set
            checkedLeaders.forEach(leader => {
                const props = this.currentData.leaders[leader];
                Object.values(props).forEach(colorRef => {
                    if (!safeColors.has(colorRef)) {
                        missingColors.add(colorRef);
                    }
                });
            });

            if (missingColors.size > 0) {
                const missingArray = Array.from(missingColors);
                warningEl.innerHTML = `<span style="vertical-align: middle;">⚠️</span> Missing dependencies: ${missingArray.slice(0, 3).join(', ')}${missingArray.length > 3 ? ` + ${missingArray.length - 3} more` : ''}.<br><span style="font-weight: normal;">Importing these leaders will result in broken textures.</span>`;
                confirmBtn.style.opacity = '0.5';
            } else {
                warningEl.innerHTML = '';
                confirmBtn.style.opacity = '1';
            }
        },

        getFilteredData: function() {
            const filtered = { colors: {}, leaders: {} };
            
            document.querySelectorAll('.staging-color-cb:checked').forEach(cb => {
                filtered.colors[cb.value] = this.currentData.colors[cb.value];
            });

            document.querySelectorAll('.staging-leader-cb:checked').forEach(cb => {
                filtered.leaders[cb.value] = this.currentData.leaders[cb.value];
            });

            return filtered;
        }
    };
	// ═══════════════════════════════════════════════════════════════
    // MOD EXPORT
    // ═══════════════════════════════════════════════════════════════
const WorkshopExport = {
        
        _mapAppLangToCivLocale: function(appLang) {
            const map = {
                'en': 'en_US',
                'zh-Hans': 'zh_Hans_CN', 'zh-CN': 'zh_Hans_CN',
                'zh-Hant': 'zh_Hant_HK', 'zh-TW': 'zh_Hant_HK',
                'fr': 'fr_FR',
                'de': 'de_DE',
                'it': 'it_IT',
                'ja': 'ja_JP',
                'ko': 'ko_KR',
                'pl': 'pl_PL',
                'pt': 'pt_BR', 'pt-BR': 'pt_BR',
                'ru': 'ru_RU',
                'es': 'es_ES'
            };
            return map[appLang] || 'en_US'; // Fallback to en_US if unmapped
        },

        generateModinfo: function(details) {
            const locPrefix = `LOC_MOD_${details.id.replace(/-/g, '_').toUpperCase()}`;
            
            return `<?xml version="1.0" encoding="utf-8"?>
<Mod id="${details.id}" version="${details.version}" xmlns="ModInfo">
    <Properties>
        <Name>${locPrefix}_NAME</Name>
        <Version>${details.version}</Version>
        <Description>${locPrefix}_DESCRIPTION</Description>
        <Authors>${details.author}</Authors>
        <Package>Mod</Package>
        <URL>https://sibr3.github.io/sib-color-configurator/</URL>
        <AffectsSavedGames>0</AffectsSavedGames>
    </Properties>
    <Dependencies>
        <Mod id="base-standard" title="LOC_MODULE_BASE_STANDARD_NAME"/>
        <Mod id="sib-color-configurator-core" title="SiBr3's Color Configurator"/>
    </Dependencies>
    <ActionCriteria>
        <Criteria id="always">
            <AlwaysMet></AlwaysMet>
        </Criteria>
    </ActionCriteria>
    <ActionGroups>
        <ActionGroup id="${details.id}-game" scope="game" criteria="always">
            <Properties>
                <LoadOrder>1000</LoadOrder>
            </Properties>
            <Actions>
                <UpdateColors>
                    <Item>/sql/${details.id}-colors.sql</Item>
                </UpdateColors>
            </Actions>
        </ActionGroup>
    </ActionGroups>
    <LocalizedText>
        <File>/text/${details.id}-text.xml</File>
    </LocalizedText>
</Mod>`;
        },
		
        generateTextXML: function(details, translationsMap) {
            const locPrefix = `LOC_MOD_${details.id.replace(/-/g, '_').toUpperCase()}`;
            let rows = '';

            // Loop through all translations (including the base English one)
            for (const [locale, textData] of Object.entries(translationsMap)) {
                rows += `
        <Row Tag="${locPrefix}_NAME" Language="${locale}">
            <Text>${textData.name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</Text>
        </Row>
        <Row Tag="${locPrefix}_DESCRIPTION" Language="${locale}">
            <Text>${textData.description.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</Text>
        </Row>`;
            }

            return `<?xml version="1.0" encoding="utf-8"?>
<GameData>
    <LocalizedText>${rows}
    </LocalizedText>
</GameData>`;
        },

        downloadZip: async function(sqlContent, details) {
            if (typeof JSZip === 'undefined') {
                UI.notify("Export failed: JSZip library is not loaded.", "error");
                return;
            }

            Theater.simulateLoading(t('titleExportingMod') || "Packaging Mod...", 'assets/icons/sib-cc-pack.png', ["Generating Modinfo...", "Translating Data..."], 0, async () => {
                
                // 1. Assign the user's raw input to the locale they actually selected in the dropdown
                let translationsMap = {};
                translationsMap[details.locale] = { name: details.name, description: details.description };

                // 2. Fetch AI translations if checked
                if (details.autoTranslate) {
                    try {
                        const workerUrl = 'https://sib-color-configurator-translation.nathankearns.workers.dev/'; 
                        
                        const response = await fetch(workerUrl, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ name: details.name, description: details.description })
                        });

                        if (response.ok) {
                            const aiTranslations = await response.json();
                            // Merge the AI results. The AI will now generate en_US automatically,
                            // ensuring English is always English, even if the user typed in French.
                            translationsMap = { ...translationsMap, ...aiTranslations };
                        } else {
                            console.error("AI Translation failed:", await response.text());
                            UI.notify("AI Translation failed. Proceeding with base language only.", "warning");
                        }
                    } catch (e) {
                        console.error("Network error hitting AI worker", e);
                        UI.notify("Network error. Proceeding with base language only.", "warning");
                    }
                }

                // 3. Zip it all up
                const zip = new JSZip();

                zip.file(`${details.id}.modinfo`, this.generateModinfo(details));
                const modFolder = zip.folder(details.id);
                modFolder.folder("sql").file(`${details.id}-colors.sql`, sqlContent);
                modFolder.folder("text").file(`${details.id}-text.xml`, this.generateTextXML(details, translationsMap));

                const blob = await zip.generateAsync({ type: "blob" });
                
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `${details.name.replace(/[^a-zA-Z0-9 ]/g, "").replace(/\s+/g, "_")}_v${details.version.replace(/\./g, '_')}.zip`;
                document.body.appendChild(a);
                a.click();
                
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);

                UI.notify("Workshop mod package downloaded successfully!", "success");
            });
        }
    };
	
    const IO = {
        generateCombinedSQL: function() {
            const ts = new Date().toISOString();
            let lines = [
                `-- ============================================================`,
                `-- ${t('appTitle')}`,
                `-- ${t('sqlPastebinTitle')}: ${t('tabColors')} + ${t('tabLeaders')}`,
                `-- ${ts}`,
                `-- ============================================================`,
                ``,
                `-- ────────────────────────────────────────────────────────────`,
                `-- ${t('tabColors')}`,
                `-- ────────────────────────────────────────────────────────────`,
                `-- ${t('labelStandardColorSection')}`,
                `-- ↓↓↓↓`
            ];
            
            Config.DEFAULT_COLORS.forEach(c => {
                const rgba = ColorUtils.hexToRGBA255(State.colorDefs[c.type] || c.hex);
                lines.push(`-- ${tColor(c.type)}\nUPDATE Colors SET Color = '${rgba}', Color3D = '${rgba}' WHERE Type = '${c.type}';`);
            });

            lines.push(`\n-- ${t('labelSibreColorSection')}\n-- ↓↓↓↓`);
            Config.SIBR3_COLORS.forEach(c => {
                const rgba = ColorUtils.hexToRGBA255(State.colorDefs[c.type] || c.hex);
                lines.push(`-- ${tColor(c.type)}\nINSERT OR REPLACE INTO Colors (Type, Color, Color3D) VALUES ('${c.type}', '${rgba}', '${rgba}');`);
            });

            if (State.customColors.length > 0) {
                lines.push(`\n-- ${t('labelCustomColorSection')}\n-- ↓↓↓↓`);
                State.customColors.forEach(cc => {
                    const rgba = ColorUtils.hexToRGBA255(cc.hex);
                    lines.push(`-- ${cc.name || cc.id}\nINSERT OR REPLACE INTO Colors (Type, Color, Color3D) VALUES ('${cc.id}', '${rgba}', '${rgba}');`);
                });
            }

            lines.push(`\n-- ────────────────────────────────────────────────────────────`);
            lines.push(`-- ${t('tabLeaders')}`);
            lines.push(`-- ────────────────────────────────────────────────────────────\n`);

            Config.DEFAULT_LEADERS.forEach(leader => {
                const s = State.leaderSelections[leader.type];
                lines.push(`-- ${tLeader(leader.type, leader.name)}`);
                lines.push(`UPDATE PlayerColors SET PrimaryColor = '${s.primary}', SecondaryColor = '${s.secondary}', Alt1PrimaryColor = '${s.alt1Primary}', Alt1SecondaryColor = '${s.alt1Secondary}', Alt2PrimaryColor = '${s.alt2Primary}', Alt2SecondaryColor = '${s.alt2Secondary}', Alt3PrimaryColor = '${s.alt3Primary}', Alt3SecondaryColor = '${s.alt3Secondary}' WHERE Type = '${leader.type}';`);
            });
            return lines.join('\n');
        },

        buildConfigJson: function() {
            return JSON.stringify({
                version: 5,
                timestamp: new Date().toISOString(),
                colorDefs: State.colorDefs,
                leaderSelections: State.leaderSelections,
                customColors: State.customColors
            }, null, 2);
        }
    };

    // ═══════════════════════════════════════════════════════════════
    // RENDERING
    // ═══════════════════════════════════════════════════════════════
    const Render = {
        colorsTable: function() {
            const table = document.getElementById('colorsTable');
            
            // Helper function to translate standard color IDs
            const tColor = id => {
                const langDict = Locale.STRINGS[State.lang] || Locale.STRINGS.en;
                return (langDict.colorNames && langDict.colorNames[id]) ? langDict.colorNames[id] : id;
            };

            const hasCustom = State.customColors && State.customColors.length > 0;
            
            // 1. Render Sticky Table Header
            let html = `
                <thead>
                    <tr>
                        <th style="background:var(--bg-surface2); text-align:left; position:sticky; top:0; z-index:11;">
                            <div style="display:flex; align-items:center; gap:8px; font-weight: bold; font-size:12pt">
                                <input type="checkbox" data-action="toggleAllCustomCb" title="Select All Custom Colors" id="masterCustomCb" style="cursor:${hasCustom ? 'pointer' : 'not-allowed'}; width:16px; height:16px; margin:0;" ${hasCustom ? '' : 'disabled'}>
                                <label for="masterCustomCb" style="cursor:${hasCustom ? 'pointer' : 'not-allowed'}; margin:0;">${t('labelColorName')}</label>
                            </div>
                        </th>
                        <th style="background:var(--bg-surface2);text-align:center; position:sticky; top:0; z-index:11; font-weight: bold; font-size:12pt">${t('labelType')}</th>
                        <th style="background:var(--bg-surface2);text-align:center; position:sticky; top:0; z-index:11; font-weight: bold; font-size:12pt">${t('labelCurrentHex')}</th>
                        <th style="background:var(--bg-surface2);text-align:center; position:sticky; top:0; z-index:11; font-weight: bold; font-size:12pt" >${t('labelPreview')}</th>
                        <th style="background:var(--bg-surface2);text-align:center; position:sticky; top:0; z-index:11;">
                            <div style="display:flex; align-items:center; justify-content:center; gap:8px; font-weight: bold; font-size:12pt">
                                <span>${t('labelActions')}</span>
                                <button class="btn btn-neutral" data-action="deleteSelectedCustom" style="background:${hasCustom ? '#f56565' : 'var(--bg-surface)'}; color:${hasCustom ? 'white' : 'var(--text-muted)'}; border-color:${hasCustom ? '#e53e3e' : 'var(--border)'}; font-weight:bold; cursor:${hasCustom ? 'pointer' : 'not-allowed'};" ${hasCustom ? '' : 'disabled'} title="${t('btnDeleteSelected') || 'Delete Selected'}">
									<img src="assets/icons/sib-cc-delete.png" style="width: 20px; height: 20px;">
								</button>
                            </div>
                        </th>
                    </tr>
                </thead>
                <tbody>
            `;

            // 2. Render Custom Colors Section Header 
            html += `<tr class="table-section-header"><td colspan="5">${t('labelCustomColorSection')}</td></tr>`;

            // 3. Render "Add Custom Color" inline row
            html += `
                <tr style="background:var(--bg-container)">
                    <td>
                        <div style="display:flex; align-items:center; gap:8px;">
                            <div style="width:16px; flex-shrink:0;"></div>
                            <input type="text" id="newColorName" placeholder="${t('placeholderColorName')}" class="table-color-input" style= "width:100%">
                        </div>
                    </td>
                    <td style="text-align:center;font-size:11px;color:var(--text-muted);font-style:italic">${t('labelAutoGenerated')}</td>
                    <td style="text-align:center"><input type="text" id="newColorHex" class="table-color-input" placeholder="${t('placeholderHex')}" value="#808080"></td>
                    <td style="text-align:center"><input class="table-swatch" type="color" id="newColorPicker" value="#808080"></td>
                    <td style="text-align:center; vertical-align:middle;">
						<div style="display:flex; gap:8px; justify-content:center;">
							<button class="btn btn-primary" data-action="addCustomColorInline">
								<img src="assets/icons/sib-cc-addcolor.png" style="width: 20px; height: 20px; vertical-align: middle;">
							</button>
							<button class="btn btn-neutral" data-action="openTrioModal" title="${t('tipTrio') || 'Trio'}">${t('btnTrio') || '✨ Trio'}</button>
						</div>
					</td>
                </tr>
            `;

            // 4. Render Custom Color Rows with Checkboxes
            if (hasCustom) {
                ColorUtils.sortColorsByHue(State.customColors, cc => cc.hex).forEach(cc => {
                    html += `<tr>
                        <td>
                            <div style="display:flex; align-items:center; gap:8px;">
                                <input type="checkbox" class="bulk-delete-cb" value="${cc.id}" style="cursor:pointer; width:16px; height:16px; flex-shrink:0;">
                                <input type="text" value="${Utils.escapeHtml(cc.name || cc.id)}" data-action="updateCustomName" data-id="${cc.id}" class="table-name-input" style="width:100%">
                            </div>
                        </td>
                        <td style="text-align:center;font-size:11px;color:var(--text-muted)">${cc.id}</td>
                        <td style="text-align:center"><input type="text" class="table-name-input" value="${cc.hex}" data-action="updateCustomHex" data-id="${cc.id}" style="margin:0 auto;display:block"></td>
                        <td style="text-align:center"><input type="color" class="table-swatch" value="${cc.hex}" data-action="updateCustomHex" data-id="${cc.id}"></td>
                        <td style="text-align:center">
							<button class="btn btn-neutral" data-action="deleteCustom" data-id="${cc.id}">
								<img src="assets/icons/sib-cc-delete.png" style="width: 20px; height: 20px;">
							</button>
						</td>
                    </tr>`;
                });
            }

            // 5. Render Standard Groups
            const renderStandardGroup = (title, items) => {
                html += `<tr class="table-section-header"><td colspan="5">${title}</td></tr>`;
                ColorUtils.sortColorsByHue(items, c => State.colorDefs[c.type] || c.hex).forEach(c => {
                    const current = State.colorDefs[c.type] || c.hex;
                    const isMod = current.toLowerCase() !== c.hex.toLowerCase();
                    const nameHtml = isMod ? `<span style="display:inline-flex;align-items:center;gap:4px"><span style="color:var(--accent);font-size:12px"><img src="assets/icons/sib-cc-sapphire.png" style="width: 16px; height: 16px;"></span>${tColor(c.type)}</span>` : tColor(c.type);
                    
                    html += `<tr ${isMod ? 'style="background:rgba(102,126,234,0.08)"' : ''}>
                        <td style="text-align:left;font-size:14px;color:var(--text-primary)">${nameHtml}</td>
                        <td title=${c.type} style="text-align:center;font-size:8pt;color:var(--text-muted); font-family: 'Monaco', monospace;">${c.type}</td>
                        <td style="text-align:center"><input type="text" class="table-name-input" value="${current}" data-action="updateDef" data-id="${c.type}" style="${isMod?'font-weight:700;':''}margin:0 auto;display:block"></td>
                        <td style="text-align:center"><input type="color" class="table-swatch" value="${current}" data-action="updateDef" data-id="${c.type}">
						</td>
                        <td style="text-align:center">${isMod ? `<button class="btn btn-neutral" data-action="resetDef" data-id="${c.type}" data-hex="${c.hex}" title="Reset to default">
							<img src="assets/icons/sib-cc-history.png" style="width: 20px; height: 20px;">
						</button>` : ''}</td>
                    </tr>`;
                });
            };

            renderStandardGroup(t('labelSibreColorSection'), Config.SIBR3_COLORS);
            renderStandardGroup(t('labelStandardColorSection'), Config.DEFAULT_COLORS);

            table.innerHTML = html + '</tbody>';

            // 6. Re-bind the inline input synchroniser for the "Add Custom Colour" row
            const hexInput = document.getElementById('newColorHex');
            const pickerInput = document.getElementById('newColorPicker');
            if (hexInput && pickerInput) {
                hexInput.addEventListener('input', (e) => pickerInput.value = e.target.value);
                pickerInput.addEventListener('input', (e) => hexInput.value = e.target.value);
            }
        },

        leadersTable: function() {
            const table = document.getElementById('leadersTable');
			let html = `	
				<thead>
						<tr>
							<th class="jersey-divider" style="width:18%;font-weight: bold; font-size:16px; padding-left: 14px;">${t('labelLeader')}</th>
							
							<th colspan="2" class="jersey-divider" style="width:17%;font-weight: bold; font-size:16px">${t('labelMain')}</th>
							<th class="jersey-swap-col"></th>
							<th colspan="2" class="jersey-divider" style="width:17%;font-weight: bold; font-size:16px">${t('labelAlt1')}</th>
							<th class="jersey-swap-col"></th>
							<th colspan="2" class="jersey-divider" style="width:17%;font-weight: bold; font-size:16px">${t('labelAlt2')}</th>
							<th class="jersey-swap-col"></th>
							<th colspan="2" class="jersey-divider" style="width:17%;font-weight: bold; font-size:16px">${t('labelAlt3')}</th>
							
							<th style="width:9%;font-weight: bold; font-size:16px">${t('labelActions')}</th>
						</tr>
					</thead><tbody>`;

            const sets = [
                { id: 'main', p: 'primary', s: 'secondary' },
                { id: 'alt1', p: 'alt1Primary', s: 'alt1Secondary' },
                { id: 'alt2', p: 'alt2Primary', s: 'alt2Secondary' },
                { id: 'alt3', p: 'alt3Primary', s: 'alt3Secondary' }
            ];

            Config.DEFAULT_LEADERS.forEach(leader => {
                const sel = State.leaderSelections[leader.type];
                const lt = leader.type;
                const portraitUrl = Config.LEADER_PORTRAITS_COMPACT[lt];

                html += `<tr>
                    <td class="jersey-divider">
                        <div style="display: flex; align-items: center; gap: 14px;">
                            ${portraitUrl ? `<img src="${portraitUrl}" class="table-portrait" data-leader-type="${lt}" alt="" loading="lazy" style="flex-shrink: 0;">` : `<div style="width:60px;height:60px;display:flex;align-items:center;justify-content:center;background:var(--bg-container);border-radius:4px;opacity:0.3;flex-shrink:0;">👤</div>`}
                            <span class="table-leader-name" style="font-weight: bold; padding-left: 0;">${tLeader(lt, leader.name)}</span>
                        </div>
                    </td>`;

                sets.forEach((set, i) => {
                    if (i > 0) {
                        html += `<td class="jersey-swap-col"><button class="btn btn-neutral jersey-swap-col-btn" data-action="swapJersey" data-leader="${lt}" data-seta="${sets[i-1].id}" data-setb="${set.id}"><img src="assets/icons/sib-cc-swap.png" style="width: 16px; height: 16px;"></button></td>`;
                    }
                    html += `
                        <td colspan="2" class="jersey-divider" style="padding:0">
                            <div class="jersey-group" data-leader="${lt}" data-set="${set.id}">
                                <div class="jersey-pair-target" data-action="targetPair" data-leader="${lt}" data-set="${set.id}"></div>
                                <div class="table-color-block" draggable="true" data-leader="${lt}" data-slot="${set.p}" style="background:${ColorUtils.resolveColorHex(sel[set.p])};flex:1;margin:0;" data-action="targetTile" title="${t('tipTileActions')}"></div>
                                <div class="table-color-block" draggable="true" data-leader="${lt}" data-slot="${set.s}" style="background:${ColorUtils.resolveColorHex(sel[set.s])};flex:1;margin:0;" data-action="targetTile" title="${t('tipTileActions')}"></div>
                            </div>
                        </td>`;
                });

                html += `<td style="padding:6px 4px;">
                            <div style="display:flex; justify-content:center; gap:6px;">
                                <button class="btn btn-neutral" data-action="openAutoModal" data-leader="${lt}">
                                    <img src="assets/icons/sib-cc-wizard.png" style="width: 22px; height: 22px;">
                                </button> 
                                <button class="btn btn-neutral" data-action="resetLeader" data-leader="${lt}">
                                    <img src="assets/icons/sib-cc-history.png" style="width: 22px; height: 22px;">
                                </button>
                            </div>
                         </td></tr>`;
            });
            
            table.innerHTML = html + '</tbody>';
            Events.attachDragListeners();
        },

        colorPicker: function() {
            const grid = document.getElementById('colorPickerGrid');
            let html = '';
            
            const addColor = (c, isCustom) => {
                const id = c.type || c.id;
                const defaultHex = c.hex || '';
                const currentHex = State.colorDefs[id] || c.hex;
                const isModified = !isCustom && defaultHex && currentHex.toLowerCase() !== defaultHex.toLowerCase();
               
                const name = isCustom ? (c.name || id) : tColor(id);
                const swatchBorder = isModified ? 'var(--accent)' : 'var(--border)';
                const labelHtml = isModified ? `<span style="color:var(--accent);font-size:10px;line-height:1"><img src="assets/icons/sib-cc-sapphire.png" style="width: 16px; height: 16px;"></span> ${name}` : name;

                // Add the reset button inline, but only if it's a modified system colour
                html += `
                <div class="color-picker-option has-actions" data-color-type="${id}">
                    <div class="color-picker-swatch" style="background:${currentHex}; border-color:${swatchBorder}" data-action="pickColor" data-id="${id}"></div>
                    <div class="color-picker-label" data-action="pickColor" data-id="${id}">${labelHtml}</div>
                    <div class="color-picker-actions">
                        <button class="btn btn-neutral" data-action="editColorPicker" data-id="${id}" data-custom="${isCustom}" title="${t('tipEdit') || 'Edit'}">
							<img src="assets/icons/sib-cc-edit.png" style="width: 20px; height: 20px;">
						</button>
                        ${isModified ? `<button class="btn btn-neutral" data-action="resetDef" data-id="${id}" data-hex="${c.hex}" title="Reset to default">
							<img src="assets/icons/sib-cc-history.png" style="width: 20px; height: 20px;">
						</button>` : ''}
                        ${isCustom ? `<button class="btn btn-danger" data-action="deleteCustom" data-id="${id}" title="${t('tipDelete') || 'Delete'}">
							<img src="assets/icons/sib-cc-delete.png" style="width: 20px; height: 20px;">
						</button>` : ''}
                    </div>
                </div>`;
            };

            if (State.customColors.length > 0) {
                html += `<div style="grid-column: 1 / -1; font-weight: bold; margin-top: 10px; color: var(--text-primary); border-bottom: 1px solid var(--border); padding-bottom: 4px;">${t('labelCustomColorSection')}</div>`;
                ColorUtils.sortColorsByHue(State.customColors, cc => cc.hex).forEach(c => addColor(c, true));
            }

            html += `<div style="grid-column: 1 / -1; font-weight: bold; margin-top: 10px; color: var(--text-primary); border-bottom: 1px solid var(--border); padding-bottom: 4px;">${t('labelSibreColorSection')}</div>`;
            ColorUtils.sortColorsByHue(Config.SIBR3_COLORS, c => State.colorDefs[c.type] || c.hex).forEach(c => addColor(c, false));
            
            html += `<div style="grid-column: 1 / -1; font-weight: bold; margin-top: 10px; color: var(--text-primary); border-bottom: 1px solid var(--border); padding-bottom: 4px;">${t('labelStandardColorSection')}</div>`;
            ColorUtils.sortColorsByHue(Config.DEFAULT_COLORS, c => State.colorDefs[c.type] || c.hex).forEach(c => addColor(c, false));
            
            grid.innerHTML = html;
            
            // Highlight current colour selected for the active slot
            const currentOption = grid.querySelector(`[data-color-type="${State.colorPickerContext.slot ? State.leaderSelections[State.colorPickerContext.leaderType][State.colorPickerContext.slot] : ''}"]`);
            if (currentOption) {
                currentOption.classList.add('current');
            }
        },

        customPoolPicker: function(leaderType, isBulk) {
            const modal = document.getElementById('customRandomPoolModal');
            modal.dataset.leaderType = leaderType || '';
            modal.dataset.isBulk = isBulk;
            
            document.getElementById('customRandomPoolTitle').textContent = isBulk ? t('modalBulkCustomTitle') : t('modalCustomPoolTitle');
            document.getElementById('customPoolDesc').textContent = isBulk ? t('modalBulkCustomDesc') : t('modalCustomPoolDesc');
                
            const grid = document.getElementById('customRandomPoolGrid');
            let html = '';
            
            const renderOption = (c, isCustom) => {
                const id = c.type || c.id;
                
                // Pulls the live modified hex if it exists, otherwise falls back to default
                const currentHex = State.colorDefs[id] || c.hex; 
                const isSelected = State.customRandomPool.includes(id); 
                const name = isCustom ? (c.name || id) : tColor(id); 
                
                return `
                <div class="custom-pool-option ${isSelected ? 'selected' : ''}" data-action="toggleCustomPoolColor" data-id="${id}">
                    <div class="custom-pool-swatch" style="background:${currentHex}"></div>
                    <div class="custom-pool-label">${name}</div>
                    <div class="custom-pool-check">${isSelected ? '<img src="assets/icons/sib-cc-tick.png" style="width: 22px; height: 22px;">' : ''}</div>
                </div>`;
            };
           
            // Explicitly pass true/false to prevent indexing bug
            if (State.customColors.length > 0) {
                html += `<div style="grid-column:1/-1;font-weight:700;font-size:12px;color:var(--text-primary);padding:8px 0 4px 0;border-bottom:1px solid var(--border);margin-bottom:8px">${t('labelCustomColorSection')}</div>`;
                html += ColorUtils.sortColorsByHue(State.customColors, cc => cc.hex).map(c => renderOption(c, true)).join('');
            }
            
            html += `<div style="grid-column:1/-1;font-weight:700;font-size:12px;color:var(--text-primary);padding:16px 0 4px 0;border-bottom:1px solid var(--border);margin-bottom:8px">${t('labelSibreColorSection')}</div>`;
            html += ColorUtils.sortColorsByHue(Config.SIBR3_COLORS, c => State.colorDefs[c.type] || c.hex).map(c => renderOption(c, false)).join('');
            
            html += `<div style="grid-column:1/-1;font-weight:700;font-size:12px;color:var(--text-primary);padding:16px 0 4px 0;border-bottom:1px solid var(--border);margin-bottom:8px">${t('labelStandardColorSection')}</div>`;
            html += ColorUtils.sortColorsByHue(Config.DEFAULT_COLORS, c => State.colorDefs[c.type] || c.hex).map(c => renderOption(c, false)).join('');
            
            grid.innerHTML = html;
            
            const btn = document.getElementById('applyCustomPoolBtn');
            const count = State.customRandomPool.length;
            const minReq = isBulk ? 10 : 2;
            const raw = t('btnApplyCount', { count: count });
            const parts = raw.split('|');
            btn.textContent = (count === 1 && parts.length > 1) ? parts[0] : (parts.length > 1 ? parts[1] : parts[0]);
            
            if (count < minReq) {
                btn.disabled = true; btn.style.opacity = '0.5'; btn.style.cursor = 'not-allowed';
                btn.title = t('notifMinColors', { min: minReq });
            } else {
                btn.disabled = false; btn.style.opacity = '1'; btn.style.cursor = 'pointer';
                btn.title = '';
            }
        }
    };
	
	// ═══════════════════════════════════════════════════════════════
    // LOADING SCREENS
    // ═══════════════════════════════════════════════════════════════
	
	const Theater = {
		activeTimer: null,
		activeTimeout: null,
		isCancelled: false,

		// Kill switch
		cancel: function() {
			Theater.isCancelled = true;
			
			// Kill the loop
			if (Theater.activeTimer) {
				clearInterval(Theater.activeTimer);
				Theater.activeTimer = null;
			}
			// Kill the final pause just in case
			if (Theater.activeTimeout) {
				clearTimeout(Theater.activeTimeout);
				Theater.activeTimeout = null;
			}
			
			// --- RESTORE MOUSE, HIDE AND RESET WATCH ---
			document.body.style.cursor = ''; 
			const watchCursor = document.getElementById('theaterWatchCursor');
			if (watchCursor) {
				watchCursor.style.display = 'none';
				watchCursor.style.visibility = 'visible'; // Reset it for the next run
			}
			
			UI.closeModal('loadingModal');
		},

		simulateLoading: function(title, icon, items, duration, onComplete) {
			// 1. Hard reset on boot
			Theater.cancel(); 
			Theater.isCancelled = false;
			
			// Autopilot
			let finalDuration = duration;
			
			// Override for 0, null, or undefined
			if (!finalDuration || finalDuration <= 0) {
				const itemCount = (items && items.length) ? items.length : 0;
				
				const timePerItem = 200; // 600ms per item
				const minTime = 600;    // Absolute minimum
				const maxTime = 2000;    // Absolute maximum
				
				finalDuration = Math.min(Math.max(itemCount * timePerItem, minTime), maxTime);
			}
		
			// 2. Grab elements
			const titleEl = document.getElementById('loadTitle');                                              
			const textEl = document.getElementById('loadSubtext');
			const iconEl = "";
			const barEl = document.getElementById('progressBar');
			const cancelBtn = document.getElementById('btnLoadingModalCancel');
			const closeBox = document.getElementById('btnLoadingModalClose');

			// 3. Bind cancel function
			if (cancelBtn) cancelBtn.onclick = function() { Theater.cancel(); };
			if (closeBox) closeBox.onclick = function() { Theater.cancel(); };

			// 4. Setup UI
            titleEl.textContent = title;
            barEl.style.width = '0%';
            textEl.textContent = t('theaterInit');
            document.body.style.cursor = 'none'; // Make the real mouse invisible
            document.getElementById('theaterWatchCursor').style.display = 'block';
			
            UI.openModal('loadingModal');

            const targetedIconEl = document.querySelector('#loadingModal .modal-title-icon');
            
            if (targetedIconEl) {
                targetedIconEl.src = icon ? icon : 'assets/icons/sib-cc-generic.png';
            }

			// 5. Start Engine
			let progress = 0;
			const intervalTime = 50; 
			
			const totalSteps = finalDuration / intervalTime;
		
			Theater.activeTimer = setInterval(() => {
				// Failsafe: if cancelled, do nothing
				if (Theater.isCancelled) return;

				progress++;
				const percent = (progress / totalSteps) * 100;
				barEl.style.width = percent + '%';
				
				if (items && items.length > 0) {
					const itemIndex = Math.floor((progress / totalSteps) * items.length);
					if (itemIndex < items.length) {
						textEl.textContent = t('theaterProcess') + items[itemIndex] + "...";
					}
				} else {
					textEl.textContent = t('theaterWork');
				}
				
				if (progress >= totalSteps) {
					clearInterval(Theater.activeTimer);
					Theater.activeTimer = null;
					barEl.style.width = '100%';
					textEl.textContent = t('theaterDone')
					
					// Track the timeout so can kill it if cancelled at 99.9%
					Theater.activeTimeout = setTimeout(() => {
						if (!Theater.isCancelled) {
							// --- RESTORE MOUSE, HIDE AND RESET WATCH ---
							document.body.style.cursor = ''; 
							const watchCursor = document.getElementById('theaterWatchCursor');
							if (watchCursor) {
								watchCursor.style.display = 'none';
								watchCursor.style.visibility = 'visible'; // Reset it for the next run
							}
							UI.closeModal('loadingModal');
							onComplete(); 
						}
					}, 1000);
				}
			}, intervalTime);
		}
	};

    // ═══════════════════════════════════════════════════════════════
    // EVENT CONTROLLER
    // ═══════════════════════════════════════════════════════════════
    const Events = {
        init: function() {

        const activeOption = document.querySelector(`.dropdown-options li[data-lang="${State.lang}"]`);
        
        if (activeOption) {
            //Update the visual text on the dropdown button
            document.getElementById('langText').textContent = activeOption.textContent;
            
            //Move the active highlight class to the correct item
            document.querySelectorAll('.dropdown-options li').forEach(opt => opt.classList.remove('active'));
            activeOption.classList.add('active');
        }
        
        document.documentElement.lang = State.lang;
		
            document.addEventListener('click', e => {

            const dropdownBtn = e.target.closest('#langSelected');
            if (dropdownBtn) {
                document.getElementById('langDropdown').classList.toggle('open');
                return; // Stop the click from triggering anything else
            }

            const langOption = e.target.closest('.dropdown-options li');
            if (langOption) {
                const selectedLang = langOption.getAttribute('data-lang');
                
                // Update the visual UI
                document.querySelectorAll('.dropdown-options li').forEach(opt => opt.classList.remove('active'));
                langOption.classList.add('active');
                document.getElementById('langText').textContent = langOption.textContent;
                document.getElementById('langDropdown').classList.remove('open');

                // Localisation logic
                State.lang = selectedLang; 
                localStorage.setItem('sib-color-configurator_lang', State.lang);
				document.documentElement.lang = State.lang;
				UI.applyStrings();
				
                
                
                return; // Stop the click from triggering anything else
            }

            // If clickinh anywhere else on the page, close the dropdown
            const openDropdown = document.getElementById('langDropdown');
            if (openDropdown && openDropdown.classList.contains('open') && !e.target.closest('#langDropdown')) {
                openDropdown.classList.remove('open');
            }
				
				const copyPathBtn = e.target.closest('.copy-path-btn');
                
				if (copyPathBtn) {
                    navigator.clipboard.writeText(copyPathBtn.dataset.path).then(() => {
                        const status = copyPathBtn.nextElementSibling;
                        if (status && status.classList.contains('copy-status')) {
                            status.style.opacity = '1';
                            setTimeout(() => status.style.opacity = '0', 2000);
                        }
                    });
                    return;
                }
				
				const actionEl = e.target.closest('[data-action]');
                const closeEl = e.target.closest('[data-modal-close]');
                const tabEl = e.target.closest('[data-tab]');

                if (closeEl) { UI.closeModal(closeEl.dataset.modalClose); return; }
                if (tabEl) { this.switchTab(tabEl.dataset.tab); return; }

                if (!actionEl) {
                    if (e.target.classList.contains('modal')) e.target.classList.remove('active');
                    return;
                }
				
                const action = actionEl.dataset.action;
                const ds = actionEl.dataset;

                switch(action) {
                    case 'exportSql':
                        UI.showPastebin(t('sqlPastebinTitle'), IO.generateCombinedSQL(), t('sqlPastebinFooter'), 'colors.sql');
                        break;
                    case 'exportConfig':
						const lingerWeight = 15; 
						const baseSteps = [
							...Array(lingerWeight).fill(`${t('tabColors')} - ${t('labelCustomColorSection')}`),
							...Array(lingerWeight).fill(`${t('tabColors')} - ${t('labelSibreColorSection')}`),
							...Array(lingerWeight).fill(`${t('tabColors')} - ${t('labelStandardColorSection')}`)
						];
							
						const leaderSteps = Config.DEFAULT_LEADERS.map(l => 
							`${t('tabLeaders')} - ${tLeader(l.type, l.name)}` 
						);
						
						const processingExportSteps = [...baseSteps, ...leaderSteps];
						
						Theater.simulateLoading(t('titleCompilingExport'), 'assets/icons/sib-cc-compile.png' , processingExportSteps, 0, () => {
							const jsonString = IO.buildConfigJson();
							
							// Create the Blob and download link
							const blob = new Blob([jsonString], { type: 'application/json' });
							const url = URL.createObjectURL(blob);
							
							const a = document.createElement('a');
							a.href = url;
							a.download = 'config.json';
							
							// Trigger the download
							document.body.appendChild(a);
							a.click();
							document.body.removeChild(a);
							
							// Clean up memory
							URL.revokeObjectURL(url);
							
							UI.notify(t('notifConfigExported'), 'success');
						});
                        break;
					case 'exportWorkshopZip': UI.openModal('exportWorkshopModal'); break;
                    case 'loadConfig': document.getElementById('fileInput').click(); break;
                    case 'loadExternalMod':
                        UI.openModal('advancedImportModal');
                        break;
                    case 'resetColors':
                        UI.confirm(t('confirmResetColors'), () => {
                            
                            // Combine both colour dictionaries and pull their localised names
                            const resetSteps = [...Config.DEFAULT_COLORS, ...Config.SIBR3_COLORS].map(c => 
                                t(c.name) || c.type // Fallback to the ID if name is missing
                            );

                            Theater.simulateLoading(t('titleRestoringData'), 'assets/icons/sib-cc-history.png', resetSteps, 0, () => {
                                
                                Config.DEFAULT_COLORS.forEach(c => State.colorDefs[c.type] = c.hex);
                                Config.SIBR3_COLORS.forEach(c => State.colorDefs[c.type] = c.hex);
                                
                                persist(); 
                                Render.colorsTable(); 
                                Render.leadersTable();
                                UI.applyStrings(); 
                                UI.notify(t('notifResetColors'), 'success');
                                
                            });
                        });
                        break;
                    case 'resetLeaders':
						const leaderNames = Config.DEFAULT_LEADERS.map(l => tLeader(l.type, l.name));
						
							UI.confirm(t('confirmResetLeaders'), () => {
								Theater.simulateLoading(t('titleRestoringData'), 'assets/icons/sib-cc-history.png', leaderNames, 0, () => {
									Config.DEFAULT_LEADERS.forEach(l => {
										State.leaderSelections[l.type] = { primary: l.defaultPrimary, secondary: l.defaultSecondary, alt1Primary: l.defaultAlt1P, alt1Secondary: l.defaultAlt1S, alt2Primary: l.defaultAlt2P, alt2Secondary: l.defaultAlt2S, alt3Primary: l.defaultAlt3P, alt3Secondary: l.defaultAlt3S };
									});
									persist(); Render.leadersTable();
									UI.applyStrings(); UI.notify(t('notifResetLeaders'), 'success');
								});
							});
                        break;
                    case 'bulkAuto':
                        document.getElementById('bulkAutoModalTitle').textContent = t('modalBulkAutoTitle');
                        document.getElementById('bulkAutoDesc').textContent = t('modalBulkAutoDesc');
                        document.getElementById('bulkAutoMethodButtons').innerHTML = `
                            <button class="auto-gen-method-btn" onclick="SiBr3Configurator.applyBulkAuto('curated')"><span class="method-icon"><img src="assets/icons/sib-cc-custom.png" style="width: 32px; height: 32px;"></span><span class="method-title">${t('autoMethodCurated')}</span><span class="method-desc">${t('autoDescCurated')}</span></button>
                            <button class="auto-gen-method-btn" onclick="SiBr3Configurator.applyBulkAuto('default')"><span class="method-icon"><img src="assets/icons/sib-cc-controller.png" style="width: 32px; height: 32px;"></span><span class="method-title">${t('autoMethodDefault')}</span><span class="method-desc">${t('autoDescDefault')}</span></button>
                            <button class="auto-gen-method-btn" data-action="openBulkCustomPool"><span class="method-icon"><img src="assets/icons/sib-cc-edit.png" style="width: 32px; height: 32px;"></span><span class="method-title">${t('autoMethodCustom')}</span><span class="method-desc">${t('autoDescCustomMin', {count: State.customRandomPool.length})}</span></button>
                            <button class="auto-gen-method-btn" onclick="SiBr3Configurator.applyBulkAuto('all')"><span class="method-icon"><img src="assets/icons/sib-cc-die.png" style="width: 32px; height: 32px;"></span><span class="method-title">${t('autoMethodAll')}</span><span class="method-desc">${t('autoDescAll')}</span></button>
                            <button class="auto-gen-method-btn" onclick="SiBr3Configurator.applyBulkAuto('theory')"><span class="method-icon"><img src="assets/icons/sib-cc-colortheory2.png" style="width: 32px; height: 32px;"></span><span class="method-title">${t('autoMethodTheory')}</span><span class="method-desc">${t('autoDescTheory')}</span></button>
                        `;
                        UI.openModal('bulkAutoModal');
                        break;
                    case 'openBulkCustomPool':
                        UI.closeModal('bulkAutoModal');
                        Render.customPoolPicker('', true);
                        UI.openModal('customRandomPoolModal');
                        break;
                    case 'addCustomColorInline':
                        const name = document.getElementById('newColorName').value.trim();
                        const hex = document.getElementById('newColorHex').value.trim();
                        if (!/^#[0-9a-fA-F]{6}$/i.test(hex)) { UI.notify(t('notifInvalidHex'), 'error'); break; }
                        const id = 'COLOR_CUSTOM_' + String(State.customColors.length ? Math.max(...State.customColors.map(c => parseInt(c.id.replace(/[^\d]/g, '') || 0))) + 1 : 1).padStart(3, '0');
                        State.customColors.push({ id, name: name || `${t('labelCustomColor')} ${State.customColors.length + 1}`, hex: hex.toUpperCase() });
                        persist(); UI.applyStrings();
                        document.getElementById('newColorName').value = '';
                        break;
                    case 'deleteCustom':
                        UI.confirm(t('confirmDeleteCustom'), () => {
                            State.customColors = State.customColors.filter(c => c.id !== ds.id);
                            State.customRandomPool = State.customRandomPool.filter(c => c !== ds.id);
                            Config.DEFAULT_LEADERS.forEach(l => {
                                const s = State.leaderSelections[l.type];
                                Object.keys(s).forEach(k => { if(s[k] === ds.id) s[k] = 'COLOR_STANDARD_WHITE_MD'; });
                            });
                            persist(); UI.applyStrings();
                        });
                        break;
					case 'toggleAllCustomCb':
                        const isChecked = e.target.checked;
                        document.querySelectorAll('.bulk-delete-cb').forEach(cb => cb.checked = isChecked);
                        break;
                        
                    case 'deleteSelectedCustom':
                        const checkedIds = Array.from(document.querySelectorAll('.bulk-delete-cb:checked')).map(cb => cb.value);
                        if (checkedIds.length === 0) {
                            UI.notify(t('notifNoneSelected'), 'info');
                            break;
                        }
                        
                        // Check if the user selected every single custom colour
                        const isAll = checkedIds.length === State.customColors.length;
                        
                        // Swap the warning prompt based on the selection size
                        const promptMsg = isAll 
                            ? t('confirmDeleteAll') 
                            : t('confirmDeleteSelected').replace('{count}', checkedIds.length);
                        
                        UI.confirm(promptMsg, () => {
							// Map the IDs to actual names
                            const checkedNames = checkedIds.map(id => {
                                const colorObj = State.customColors.find(c => c.id === id);
                                return colorObj ? colorObj.name : id; // Fallback to ID if name is missing
                            });
							Theater.simulateLoading(t('titlePurgingData'), 'assets/icons/sib-cc-delete.png', checkedNames, 0, () => {
								State.customColors = State.customColors.filter(c => !checkedIds.includes(c.id));
								State.customRandomPool = State.customRandomPool.filter(c => !checkedIds.includes(c));
								Config.DEFAULT_LEADERS.forEach(l => {
									const s = State.leaderSelections[l.type];
									Object.keys(s).forEach(k => { if(checkedIds.includes(s[k])) s[k] = 'COLOR_STANDARD_WHITE_MD'; });
								});
								persist(); UI.applyStrings();
								UI.notify(isAll ? `Deleted all custom colors.` : `Deleted ${checkedIds.length} custom colors.`, 'success');
							});
						});
                        break;
                    case 'resetDef':
                        State.colorDefs[ds.id] = ds.hex;
                        persist(); UI.applyStrings();
                        break;
                    case 'targetTile':
                        this.handleTileClick(ds.leader, ds.slot, actionEl, e);
                        break;
                    case 'targetPair':
                        if (State.eyedropper && State.eyedropper.copiedColor?.type === 'pair') {
                            const { primaryType, secondaryType } = State.eyedropper.copiedColor;
                            const map = { main:['primary','secondary'], alt1:['alt1Primary','alt1Secondary'], alt2:['alt2Primary','alt2Secondary'], alt3:['alt3Primary','alt3Secondary'] };
                            State.leaderSelections[ds.leader][map[ds.set][0]] = primaryType;
                            State.leaderSelections[ds.leader][map[ds.set][1]] = secondaryType;
                            persist(); Render.leadersTable();
                        }
                        break;
                    case 'swapJersey':
                        const map = { main:['primary','secondary'], alt1:['alt1Primary','alt1Secondary'], alt2:['alt2Primary','alt2Secondary'], alt3:['alt3Primary','alt3Secondary'] };
                        const s = State.leaderSelections[ds.leader];
                        const tempP = s[map[ds.seta][0]]; const tempS = s[map[ds.seta][1]];
                        s[map[ds.seta][0]] = s[map[ds.setb][0]]; s[map[ds.seta][1]] = s[map[ds.setb][1]];
                        s[map[ds.setb][0]] = tempP; s[map[ds.setb][1]] = tempS;
                        persist(); Render.leadersTable();
                        break;
                    case 'openAutoModal':
                        document.getElementById('autoGenModalTitle').textContent = t('modalAutoGenTitle', { leader: tLeader(ds.leader, Config.DEFAULT_LEADERS.find(l=>l.type===ds.leader).name) });
                        document.getElementById('autoGenMethodButtons').innerHTML = `
                            <button class="auto-gen-method-btn" onclick="SiBr3Configurator.applyAuto('${ds.leader}', 'curated')"><span class="method-icon"><img src="assets/icons/sib-cc-custom.png" style="width: 32px; height: 32px;"></span><span class="method-title">${t('autoMethodCurated')}</span><span class="method-desc">${t('autoDescCurated')}</span></button>
                            <button class="auto-gen-method-btn" onclick="SiBr3Configurator.applyAuto('${ds.leader}', 'default')"><span class="method-icon"><img src="assets/icons/sib-cc-controller.png" style="width: 32px; height: 32px;"></span><span class="method-title">${t('autoMethodDefault')}</span><span class="method-desc">${t('autoDescDefault')}</span></button>
                            <button class="auto-gen-method-btn" data-action="openCustomPool" data-leader="${ds.leader}"><span class="method-icon"><img src="assets/icons/sib-cc-edit.png" style="width: 32px; height: 32px;"></span><span class="method-title">${t('autoMethodCustom')}</span><span class="method-desc">${t('autoDescCustom', {count: State.customRandomPool.length})}</span></button>
                            <button class="auto-gen-method-btn" onclick="SiBr3Configurator.applyAuto('${ds.leader}', 'all')"><span class="method-icon"><img src="assets/icons/sib-cc-die.png" style="width: 32px; height: 32px;"></span><span class="method-title">${t('autoMethodAll')}</span><span class="method-desc">${t('autoDescAll')}</span></button>
                            <button class="auto-gen-method-btn" onclick="SiBr3Configurator.applyAuto('${ds.leader}', 'theory')"><span class="method-icon"><img src="assets/icons/sib-cc-colortheory2.png" style="width: 32px; height: 32px;"></span><span class="method-title">${t('autoMethodTheory')}</span><span class="method-desc">${t('autoDescTheory')}</span></button>
                        `;
                        UI.openModal('autoGenModal');
                        break;
                    case 'openCustomPool':
                        UI.closeModal('autoGenModal');
                        Render.customPoolPicker(ds.leader, false);
                        UI.openModal('customRandomPoolModal');
                        break;
                    case 'toggleCustomPoolColor':
                        const idx = State.customRandomPool.indexOf(ds.id);
                        if (idx === -1) State.customRandomPool.push(ds.id); else State.customRandomPool.splice(idx, 1);
                        const m = document.getElementById('customRandomPoolModal');
                        Render.customPoolPicker(m.dataset.leaderType, m.dataset.isBulk === 'true');
                        break;
                    case 'applyCustomPool':
                        const mApply = document.getElementById('customRandomPoolModal');
                        const isBulkApply = mApply.dataset.isBulk === 'true';
                        const minReq = isBulkApply ? 10 : 2;
                        if (State.customRandomPool.length < minReq) { UI.notify(t('notifMinColors', { min: minReq }), 'error'); break; }
                        UI.closeModal('customRandomPoolModal');
                        if (isBulkApply) SiBr3Configurator.applyBulkAuto('custom'); else SiBr3Configurator.applyAuto(mApply.dataset.leaderType, 'custom');
                        break;
                    case 'clearCustomPool':
                        State.customRandomPool = [];
                        const mClr = document.getElementById('customRandomPoolModal');
                        Render.customPoolPicker(mClr.dataset.leaderType, mClr.dataset.isBulk === 'true');
                        break;
                    case 'resetLeader':
						const processingSteps = [
							'labelMain', 
							'labelAlt1', 
							'labelAlt2', 
							'labelAlt3'];
						
						Theater.simulateLoading(t('titleRestoringData'), 'assets/icons/sib-cc-wizard.png', processingSteps.map(t), 0, () => {
							const l = Config.DEFAULT_LEADERS.find(x => x.type === ds.leader);
							State.leaderSelections[l.type] = { primary: l.defaultPrimary, secondary: l.defaultSecondary, alt1Primary: l.defaultAlt1P, alt1Secondary: l.defaultAlt1S, alt2Primary: l.defaultAlt2P, alt2Secondary: l.defaultAlt2S, alt3Primary: l.defaultAlt3P, alt3Secondary: l.defaultAlt3S };
							persist(); Render.leadersTable(); UI.notify(t('notifLeaderReset', {name: tLeader(l.type, l.name)}));
						});	
                        break;
                    case 'toggleEyedropper':
                        this.toggleEyedropper();
                        break;
                    case 'pickColor':
                        if (State.colorPickerContext.leaderType && State.colorPickerContext.slot) {
                            State.leaderSelections[State.colorPickerContext.leaderType][State.colorPickerContext.slot] = ds.id;
                            persist(); Render.leadersTable(); UI.closeModal('colorPickerModal');
                        }
                        break;
                    case 'editColorPicker':
                        const isCustomEditPicker = ds.custom === 'true';
                        let cName, cHex;
                        if (isCustomEditPicker) {
                            const c = State.customColors.find(x => x.id === ds.id);
                            if (!c) return;
                            cName = c.name; cHex = c.hex;
                        } else {
                            cName = tColor(ds.id);
                            cHex = State.colorDefs[ds.id] || '#808080';
                        }
                        
                        // Grab the input and apply disabled states if it's a system colour
                        const nameInput = document.getElementById('quickColorName');
                        nameInput.value = cName;
                        nameInput.disabled = !isCustomEditPicker;
                        nameInput.style.opacity = isCustomEditPicker ? '1' : '0.5';
                        nameInput.style.cursor = isCustomEditPicker ? 'text' : 'not-allowed';
                        nameInput.title = isCustomEditPicker ? '' : 'Standard color names cannot be changed';
                        
                        document.getElementById('quickColorHex').value = cHex;
                        document.getElementById('quickColorPicker').value = cHex;
                        document.getElementById('quickColorPicker').style.borderColor = 'var(--accent)';
                        document.getElementById('quickColorEditMode').value = 'edit';
                        document.getElementById('quickColorEditId').value = ds.id;
                        document.getElementById('quickColorIsCustom').value = isCustomEditPicker;
                        
                        document.getElementById('quickColorModeLabel').textContent = t('labelEditColor');
                        document.getElementById('quickColorBtn').innerHTML = `<img src="assets/icons/sib-cc-tick.png" style="width: 22px; height: 22px;">`;
                        document.getElementById('quickColorCancelBtn').style.display = 'block';
                        
                        const tileScroll = document.querySelector(`[data-color-type="${ds.id}"]`);
                        if(tileScroll) tileScroll.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        break;
                    case 'deleteColorPicker':
                        const colorToDelete = State.customColors.find(c => c.id === ds.id);
                        if (!colorToDelete || !confirm(`Delete "${colorToDelete.name}"?`)) return;
                        State.customColors = State.customColors.filter(c => c.id !== ds.id);
                        State.customRandomPool = State.customRandomPool.filter(c => c !== ds.id);
                        Config.DEFAULT_LEADERS.forEach(l => {
                            const s = State.leaderSelections[l.type];
                            Object.keys(s).forEach(k => { if(s[k] === ds.id) s[k] = 'COLOR_STANDARD_WHITE_MD'; });
                        });
                        persist();
                        const savedScroll = document.querySelector('#colorPickerModal .modal-content').scrollTop;
                        Render.colorPicker();
                        document.querySelector('#colorPickerModal .modal-content').scrollTop = savedScroll;
                        UI.applyStrings();
                        UI.notify(t('notifColorDeleted', { name: colorToDelete.name }), 'info');
                        break;
                    case 'quickColorApply':
                        const nameVal = document.getElementById('quickColorName').value.trim();
                        const hexVal = document.getElementById('quickColorHex').value.trim().toUpperCase();
                        const mode = document.getElementById('quickColorEditMode').value;
                        const editId = document.getElementById('quickColorEditId').value;
                        const isCustomEditQ = document.getElementById('quickColorIsCustom').value === 'true';

                        if (!/^#[0-9A-Fa-f]{6}$/.test(hexVal)) { UI.notify(t('notifInvalidHex'), 'error'); break; }

                        if (mode === 'add') {
                            const newId = 'COLOR_CUSTOM_' + String(State.customColors.length ? Math.max(...State.customColors.map(c => parseInt(c.id.replace(/[^\d]/g, '') || 0))) + 1 : 1).padStart(3, '0');
                            const dName = nameVal || `${t('labelCustomColor')} ${State.customColors.length + 1}`;
                            State.customColors.push({ id: newId, name: dName, hex: hexVal });
                            UI.notify(t('notifCustomAdded', { name: dName }), 'success');
                        } else {
                            if (isCustomEditQ) {
                                const c = State.customColors.find(x => x.id === editId);
                                if (c) { c.name = nameVal || editId; c.hex = hexVal; }
                            } else {
                                State.colorDefs[editId] = hexVal;
                            }
                            UI.notify(t('notifColorUpdated', { name: nameVal || editId }), 'success');
                            document.querySelector('[data-action="quickColorCancel"]').click(); // Trigger cancel to clear state
                        }
                        persist(); UI.applyStrings();
                        if (document.getElementById('colorPickerModal').classList.contains('active')) {
                            const scrollSaved = document.querySelector('#colorPickerModal .modal-content').scrollTop;
                            Render.colorPicker();
                            document.querySelector('#colorPickerModal .modal-content').scrollTop = scrollSaved;
                        }
                        break;
                    case 'quickColorCancel':
                        const resetNameInput = document.getElementById('quickColorName');
                        resetNameInput.value = '';
                        resetNameInput.disabled = false;
                        resetNameInput.style.opacity = '1';
                        resetNameInput.style.cursor = 'text';
                        resetNameInput.title = '';
                        
                        document.getElementById('quickColorHex').value = '';
                        document.getElementById('quickColorPicker').value = '#808080';
                        document.getElementById('quickColorPicker').style.borderColor = 'var(--border)';
                        document.getElementById('quickColorEditMode').value = 'add';
                        document.getElementById('quickColorEditId').value = '';
                        document.getElementById('quickColorIsCustom').value = 'false';
                        document.getElementById('quickColorModeLabel').textContent = t('labelQuickAddColor');
                        document.getElementById('quickColorBtn').innerHTML = `<img src="assets/icons/sib-cc-addcolor.png" style="width: 20px; vertical-align: middle;"> `;
                        document.getElementById('quickColorCancelBtn').style.display = 'none';
                        break;
					case 'openTrioModal':
                        const existingName = document.getElementById('newColorName').value.trim();
                        const existingHex = document.getElementById('newColorHex').value.trim();
                        
                        // Reset state to defaults or captured values
                        document.getElementById('trioBaseName').value = existingName || '';
                        
                        if (/^#[0-9a-fA-F]{6}$/i.test(existingHex) && existingHex !== '#808080') {
                            document.getElementById('trioBaseHex').value = existingHex.toUpperCase();
                            document.getElementById('trioBaseColor').value = existingHex;
                        } else {
                            // Default if nothing is selected
                            document.getElementById('trioBaseHex').value = '#9B93FF';
                            document.getElementById('trioBaseColor').value = '#9B93FF';
                        }
                        
                        // Reset to Medium anchor
                        document.querySelector('input[name="trioPos"][value="MD"]').checked = true;
                        
                        UI.openModal('trioModal');
                        
                        // Force the live-update to run immediately
                        document.getElementById('trioBaseHex').dispatchEvent(new Event('input', {bubbles: true}));
                        break;
                    case 'saveColorTrio':
                        const baseName = document.getElementById('trioBaseName').value.trim() || 'Custom';
                        const nextIdNum = State.customColors.length ? Math.max(...State.customColors.map(c => parseInt(c.id.replace(/[^\d]/g, '') || 0))) + 1 : 1;
                        const prefix = 'COLOR_CUSTOM_' + String(nextIdNum).padStart(3, '0');
                        
                        // Grab final values from the hex text output spans
                        const trioData = [
                            { suffix: 'DK', label: `(${t('labelPosDark')})`, hex: document.getElementById('trioHexOutDK').textContent },
                            { suffix: 'MD', label: `(${t('labelPosMedium')})`, hex: document.getElementById('trioHexOutMD').textContent },
                            { suffix: 'LT', label: `(${t('labelPosLight')})`, hex: document.getElementById('trioHexOutLT').textContent }
                        ];
                        
                        let addedCount = 0;
                        trioData.forEach(item => {
                            if (/^#[0-9A-Fa-f]{6}$/.test(item.hex)) {
                                State.customColors.push({
                                    id: `${prefix}_${item.suffix}`,
                                    name: `${baseName} ${item.label}`,
                                    hex: item.hex.toUpperCase()
                                });
                                addedCount++;
                            }
                        });
                        
                        if(addedCount > 0) {
                            persist(); UI.applyStrings(); UI.closeModal('trioModal');
                            UI.notify(t('notifTrioAdded', { count: addedCount, name: baseName }), 'success');
                            document.getElementById('trioBaseName').value = ''; 
                        }
                        break;
                    case 'syncTrioHex':
                        document.getElementById(ds.target).value = e.target.value.toUpperCase();
                        break;
                    case 'syncTrioColor':
                        const tHex = e.target.value;
                        if(/^#[0-9A-Fa-f]{6}$/.test(tHex)) document.getElementById(ds.target).value = tHex;
                        break;
                }
            });
			
			// Live update for Trio Inputs and Sliders
            document.addEventListener('input', e => {
                
				// Sync Quick Add/Edit Colour inputs
                if (e.target.id === 'quickColorHex') {
                    if (/^#[0-9A-Fa-f]{6}$/i.test(e.target.value)) {
                        document.getElementById('quickColorPicker').value = e.target.value;
                    }
                } else if (e.target.id === 'quickColorPicker') {
                    document.getElementById('quickColorHex').value = e.target.value.toUpperCase();
                }
				
                // Live generation from Base Colour/Hex inputs
                if (e.target.id === 'trioBaseHex' || e.target.id === 'trioBaseColor') {
                    if (e.target.id === 'trioBaseHex' && /^#[0-9A-Fa-f]{6}$/i.test(e.target.value)) {
                        document.getElementById('trioBaseColor').value = e.target.value;
                    } else if (e.target.id === 'trioBaseColor') {
                        document.getElementById('trioBaseHex').value = e.target.value.toUpperCase();
                    }
                    
                    const hex = document.getElementById('trioBaseHex').value;
                    const pos = document.querySelector('input[name="trioPos"]:checked').value;
                    
					// Remove class from all radios
					document.getElementById('lblBoxTrioLT').classList.remove('bezel-selected');
					document.getElementById('lblBoxTrioMD').classList.remove('bezel-selected');
					document.getElementById('lblBoxTrioDK').classList.remove('bezel-selected');

					// Add it back only to the active one
					document.getElementById(`lblBoxTrio${pos}`).classList.add('bezel-selected');
										
                    if (!/^#[0-9A-Fa-f]{6}$/i.test(hex)) return;
                    
                    const hsl = ColorUtils.hexToHSL(hex);
                    State.trioContext = { h: hsl.h, s: hsl.s };
                    
                    let lLT, lMD, lDK;
                    if (pos === 'MD') {
                        lMD = hsl.l; lLT = Math.min(90, hsl.l + 22); lDK = Math.max(10, hsl.l - 22);
                    } else if (pos === 'LT') {
                        lLT = hsl.l; lMD = Math.max(10, hsl.l - 22); lDK = Math.max(10, hsl.l - 44);
                    } else if (pos === 'DK') {
                        lDK = hsl.l; lMD = Math.min(90, hsl.l + 22); lLT = Math.min(90, hsl.l + 44);
                    }
                    
                    document.getElementById('trioSliderLT').value = lLT;
                    document.getElementById('trioSliderMD').value = lMD;
                    document.getElementById('trioSliderDK').value = lDK;
                    
                    ['LT', 'MD', 'DK'].forEach(suffix => {
                        const L = document.getElementById(`trioSlider${suffix}`).value;
                        const newHex = ColorUtils.hslToHex(State.trioContext.h, State.trioContext.s, L);
                        document.getElementById(`trioSwatch${suffix}`).style.backgroundColor = newHex;
                        document.getElementById(`trioHexOut${suffix}`).textContent = newHex;
                    });
                    return;
                }

                // Slider lock logic
                if (e.target.dataset && e.target.dataset.action === 'slideTrio') {
                    const suffix = e.target.dataset.target;
                    let L = parseInt(e.target.value, 10);
                    
                    const valLT = parseInt(document.getElementById('trioSliderLT').value, 10);
                    const valMD = parseInt(document.getElementById('trioSliderMD').value, 10);
                    const valDK = parseInt(document.getElementById('trioSliderDK').value, 10);
                    
                    const MIN_GAP = 2; 
                    
                    if (suffix === 'LT') {
                        if (L < valMD + MIN_GAP) L = valMD + MIN_GAP;
                    } else if (suffix === 'MD') {
                        if (L > valLT - MIN_GAP) L = valLT - MIN_GAP;
                        if (L < valDK + MIN_GAP) L = valDK + MIN_GAP;
                    } else if (suffix === 'DK') {
                        if (L > valMD - MIN_GAP) L = valMD - MIN_GAP;
                    }
                    
                    e.target.value = L;
                    
                    const newHex = ColorUtils.hslToHex(State.trioContext.h, State.trioContext.s, L);
                    
                    document.getElementById(`trioSwatch${suffix}`).style.backgroundColor = newHex;
                    document.getElementById(`trioHexOut${suffix}`).textContent = newHex;

                    const activeBasePos = document.querySelector('input[name="trioPos"]:checked').value;
                    if (suffix === activeBasePos) {
                        document.getElementById('trioBaseHex').value = newHex;
                        document.getElementById('trioBaseColor').value = newHex;
                    }
                }
            });
			
            document.addEventListener('contextmenu', e => {
                const tile = e.target.closest('[data-action="targetTile"]');
                const pair = e.target.closest('[data-action="targetPair"]');
                if (!State.eyedropper) return;
                
                if (tile) {
                    e.preventDefault();
                    const colorType = State.leaderSelections[tile.dataset.leader][tile.dataset.slot];
                    const hex = ColorUtils.resolveColorHex(colorType);
                    State.eyedropper.copiedColor = { type: 'single', colorType, hex };
                    this.updateEyedropperUI(hex, tile);
                } else if (pair) {
                    e.preventDefault();
                    const map = { main:['primary','secondary'], alt1:['alt1Primary','alt1Secondary'], alt2:['alt2Primary','alt2Secondary'], alt3:['alt3Primary','alt3Secondary'] };
                    const primaryType = State.leaderSelections[pair.dataset.leader][map[pair.dataset.set][0]];
                    const secondaryType = State.leaderSelections[pair.dataset.leader][map[pair.dataset.set][1]];
                    const phex = ColorUtils.resolveColorHex(primaryType);
                    const shex = ColorUtils.resolveColorHex(secondaryType);
                    State.eyedropper.copiedColor = { type: 'pair', primaryType, secondaryType };
                    this.updateEyedropperUI(`linear-gradient(135deg, ${phex} 50%, ${shex} 50%)`, pair.closest('.jersey-group'));
                }
            });

            document.addEventListener('change', e => {
                if (!e.target.matches('[data-action]')) return;
                const ds = e.target.dataset;
                const val = e.target.value.trim();
                // If the user clicks the Light/Med/Dark radio buttons, bounce the signal to live input updater
                if (ds.action === 'updateTrioCalc') {
                    document.getElementById('trioBaseHex').dispatchEvent(new Event('input', {bubbles: true}));
                    return;
                }
                if (ds.action === 'updateCustomName') {
                    const c = State.customColors.find(x => x.id === ds.id);
                    if(c) { c.name = val || ds.id; persist(); UI.applyStrings(); }
                } else if (ds.action === 'updateCustomHex' || ds.action === 'updateDef') {
                    if (!/^#[0-9a-fA-F]{6}$/i.test(val)) { UI.notify(t('notifInvalidHex'), 'error'); UI.applyStrings(); return; }
                    if (ds.action === 'updateCustomHex') {
                        const c = State.customColors.find(x => x.id === ds.id);
                        if(c) c.hex = val.toUpperCase();
                    } else {
                        State.colorDefs[ds.id] = val.toUpperCase();
                    }
                    persist(); UI.applyStrings();
                }
            }, true);

            document.getElementById('btnGenericPastebinCopy').addEventListener('click', () => {
                navigator.clipboard.writeText(State.paths.currentPastebinText).then(() => {
                    const st = document.getElementById('genericCopyStatus');
                    st.classList.add('visible'); setTimeout(() => st.classList.remove('visible'), 2500);
                });
            });

            let hoverTimer = null;
            document.addEventListener('mouseover', e => {
                const img = e.target.closest('img.table-portrait');
                if (!img) return;
                clearTimeout(hoverTimer);
                const popup = document.getElementById('portraitPopup');
                const show = () => {
                    document.getElementById('portraitPopupImg').src = Config.LEADER_PORTRAITS[img.dataset.leaderType];
                    const r = img.getBoundingClientRect();
                    popup.style.left = Math.max(8, r.right + 10 > window.innerWidth - 228 ? r.left - 230 : r.right + 10) + 'px';
                    popup.style.top = Math.max(8, r.top + 330 > window.innerHeight ? window.innerHeight - 338 : r.top) + 'px';
                    popup.classList.add('visible');
                };
                if (popup.classList.contains('visible')) show(); else hoverTimer = setTimeout(show, 400);
            });
            document.addEventListener('mouseout', e => {
                if (!e.target.closest('img.table-portrait') || (e.relatedTarget && e.relatedTarget.closest('img.table-portrait'))) return;
                clearTimeout(hoverTimer);
                document.getElementById('portraitPopup').classList.remove('visible');
            });
        },

        switchTab: function(tabName) {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabName));
            document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
            document.getElementById(`tab-${tabName}`).classList.add('active');
            document.body.classList.toggle('tab-leaders', tabName === 'leaders');
            if (tabName !== 'leaders' && State.eyedropper) this.toggleEyedropper();
        },

        handleTileClick: function(leader, slot, el, e) {
            if (!State.eyedropper) {
                State.colorPickerContext = { leaderType: leader, slot: slot };
                Render.colorPicker();
                UI.openModal('colorPickerModal');
                // Ensure quick add UI is reset when opening picker fresh
                document.querySelector('[data-action="quickColorCancel"]').click();
                return;
            }
            if (State.eyedropper.copiedColor && State.eyedropper.copiedColor.type === 'single') {
                State.leaderSelections[leader][slot] = State.eyedropper.copiedColor.colorType;
                persist(); Render.leadersTable();
                el.style.transition = 'outline 0s'; el.style.outline = '3px solid #22c55e';
                setTimeout(() => { el.style.outline = ''; el.style.transition = ''; }, 300);
            }
        },

        toggleEyedropper: function() {
            if (State.eyedropper) {
                State.eyedropper = null;
                document.body.classList.remove('eyedropper-active', 'eyedropper-has-color');
                document.getElementById('eyedropperTool').classList.remove('active-mode', 'has-color');
                document.getElementById('eyedropperLabel').textContent = t('eyedropperCopy');
				document.getElementById('eyedropperLabel').style.display='none'
            } else {
                State.eyedropper = { active: true, copiedColor: null };
                document.body.classList.add('eyedropper-active');
                document.getElementById('eyedropperTool').classList.add('active-mode');
                document.getElementById('eyedropperLabel').textContent = t('eyedropperActive');
				document.getElementById('eyedropperLabel').style.display="flex";
            }
        },

        updateEyedropperUI: function(background, flashEl) {
            document.body.classList.add('eyedropper-has-color');
            document.getElementById('eyedropperTool').classList.add('has-color');
            document.getElementById('eyedropperSwatch').style.background = background;
            if(flashEl) {
                flashEl.style.transition = 'outline 0s'; flashEl.style.outline = '3px solid #f59e0b';
                setTimeout(() => { flashEl.style.outline = ''; flashEl.style.transition = ''; }, 300);
            }
        },

        attachDragListeners: function() {
            document.querySelectorAll('.data-table .table-color-block[draggable]').forEach(tile => {
                tile.addEventListener('dragstart', e => {
                    State.drag = { type: 'tile', leaderType: tile.dataset.leader, slot: tile.dataset.slot };
                    tile.classList.add('tile-dragging'); e.dataTransfer.effectAllowed = 'move';
                });
                tile.addEventListener('dragend', () => {
                    tile.classList.remove('tile-dragging');
                    document.querySelectorAll('.tile-drag-over').forEach(el => el.classList.remove('tile-drag-over'));
                    State.drag = null;
                });
                tile.addEventListener('dragover', e => {
                    if (!State.drag) return; e.preventDefault();
                    if (State.drag.leaderType !== tile.dataset.leader || State.drag.slot !== tile.dataset.slot) tile.classList.add('tile-drag-over');
                });
                tile.addEventListener('dragleave', () => tile.classList.remove('tile-drag-over'));
                tile.addEventListener('drop', e => {
                    e.preventDefault(); tile.classList.remove('tile-drag-over');
                    if (!State.drag) return;
                    const { leaderType: sLeader, slot: sSlot } = State.drag;
                    const dLeader = tile.dataset.leader; const dSlot = tile.dataset.slot;
                    if (sLeader === dLeader && sSlot === dSlot) return;
                    const temp = State.leaderSelections[sLeader][sSlot];
                    State.leaderSelections[sLeader][sSlot] = State.leaderSelections[dLeader][dSlot];
                    State.leaderSelections[dLeader][dSlot] = temp;
                    persist(); Render.leadersTable();
                });
            });
        }
    };

    // ═══════════════════════════════════════════════════════════════
    // GAME DATABASE (colors.sqlite + sib-content.sqlite)
    // ═══════════════════════════════════════════════════════════════
    const GameDatabase = {
        _sql: null,
        _LANGS: ['en','de','es','fr','it','pl','pt_BR','ru','ko','ja','zh_Hans','zh_Hant'],

        async load() {
            try {
                this._sql = await initSqlJs({
                    locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.2/${file}`
                });
            } catch (e) {
                console.warn('[GameDatabase] sql.js failed to initialize:', e.message);
                return;
            }
            await this._loadColors();
            await this._loadSibContent();
        },

        async _loadColors() {
            try {
                const response = await fetch('data/colors.sqlite');
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const db = new this._sql.Database(new Uint8Array(await response.arrayBuffer()));

                const colorsResult = db.exec("SELECT Type, Color FROM Colors WHERE Type LIKE 'COLOR_STANDARD_%' ORDER BY Type");
                if (colorsResult.length) {
                    Config.DEFAULT_COLORS = colorsResult[0].values.map(([type, color]) => ({
                        type,
                        hex: GameDatabase._civColorToHex(color)
                    }));
                }

                const pcResult = db.exec(
                    'SELECT Type, PrimaryColor, SecondaryColor,' +
                    ' Alt1PrimaryColor, Alt1SecondaryColor,' +
                    ' Alt2PrimaryColor, Alt2SecondaryColor,' +
                    ' Alt3PrimaryColor, Alt3SecondaryColor' +
                    ' FROM PlayerColors ORDER BY Type'
                );
                if (pcResult.length) {
                    const leaders = [], playerColors = [];
                    for (const [type, pri, sec, a1p, a1s, a2p, a2s, a3p, a3s] of pcResult[0].values) {
                        const entry = {
                            type,
                            defaultPrimary: pri,   defaultSecondary: sec,
                            defaultAlt1P:   a1p,   defaultAlt1S:    a1s,
                            defaultAlt2P:   a2p,   defaultAlt2S:    a2s,
                            defaultAlt3P:   a3p,   defaultAlt3S:    a3s
                        };
                        if (type.startsWith('LEADER_')) {
                            entry.name = GameDatabase._typeToName(type);
                            leaders.push(entry);
                        } else if (type.startsWith('PLAYERCOLOR_')) {
                            playerColors.push(entry);
                        }
                    }
                    Config.DEFAULT_LEADERS = leaders;
                    State.playerColors = playerColors;
                }

                db.close();
            } catch (e) {
                console.warn('[GameDatabase] colors.sqlite: falling back to bundled data:', e.message);
            }
        },

        async _loadSibContent() {
            try {
                const response = await fetch('data/sib-content.sqlite');
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const db = new this._sql.Database(new Uint8Array(await response.arrayBuffer()));
                const langs = this._LANGS;

                // SiBrColors → overwrite Config.SIBR3_COLORS + inject color names into Locale
                const sibColors = db.exec('SELECT * FROM SiBrColors ORDER BY rowid');
                if (sibColors.length) {
                    const rows = sibColors[0].values;
                    Config.SIBR3_COLORS = rows.map(r => ({ type: r[0], hex: r[1] }));
                    rows.forEach(row => {
                        const type = row[0];
                        langs.forEach((lang, i) => {
                            const name = row[i + 2];
                            if (name && Locale.STRINGS[lang]) {
                                if (!Locale.STRINGS[lang].colorNames) Locale.STRINGS[lang].colorNames = {};
                                Locale.STRINGS[lang].colorNames[type] = name;
                            }
                        });
                    });
                }

                // Leaders → inject leader names into Locale
                const leaders = db.exec('SELECT * FROM Leaders ORDER BY Type');
                if (leaders.length) {
                    leaders[0].values.forEach(row => {
                        const type = row[0];
                        langs.forEach((lang, i) => {
                            const name = row[i + 1];
                            if (name && Locale.STRINGS[lang]) {
                                if (!Locale.STRINGS[lang].leaderNames) Locale.STRINGS[lang].leaderNames = {};
                                Locale.STRINGS[lang].leaderNames[type] = name;
                            }
                        });
                    });
                }

                // CuratedColors → overwrite Config.CURATED_COLORS
                const curated = db.exec('SELECT LeaderType, ColorType FROM CuratedColors ORDER BY LeaderType, SortOrder');
                if (curated.length) {
                    Config.CURATED_COLORS = {};
                    curated[0].values.forEach(([leaderType, colorType]) => {
                        if (!Config.CURATED_COLORS[leaderType]) Config.CURATED_COLORS[leaderType] = [];
                        Config.CURATED_COLORS[leaderType].push(colorType);
                    });
                }

                db.close();
            } catch (e) {
                console.warn('[GameDatabase] sib-content.sqlite: falling back to bundled data:', e.message);
            }
        },

        generate() {
            if (!this._sql) { console.error('[GameDatabase] sql.js not ready'); return; }
            const langs = this._LANGS;
            const db = new this._sql.Database();

            db.run(`
                CREATE TABLE SiBrColors (
                    Type TEXT PRIMARY KEY, Hex TEXT NOT NULL,
                    Name_en TEXT, Name_de TEXT, Name_es TEXT, Name_fr TEXT,
                    Name_it TEXT, Name_pl TEXT, Name_pt_BR TEXT, Name_ru TEXT,
                    Name_ko TEXT, Name_ja TEXT, Name_zh_Hans TEXT, Name_zh_Hant TEXT
                );
                CREATE TABLE Leaders (
                    Type TEXT PRIMARY KEY,
                    Name_en TEXT, Name_de TEXT, Name_es TEXT, Name_fr TEXT,
                    Name_it TEXT, Name_pl TEXT, Name_pt_BR TEXT, Name_ru TEXT,
                    Name_ko TEXT, Name_ja TEXT, Name_zh_Hans TEXT, Name_zh_Hant TEXT
                );
                CREATE TABLE CuratedColors (
                    LeaderType TEXT NOT NULL, ColorType TEXT NOT NULL,
                    SortOrder INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY (LeaderType, ColorType)
                );
            `);

            const S = Locale.STRINGS;
            const leaderNameFallbacks = Object.fromEntries(Config.DEFAULT_LEADERS.map(l => [l.type, l.name]));

            // SiBrColors — COLOR_SIB_* only
            const stmt1 = db.prepare('INSERT INTO SiBrColors VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
            Config.SIBR3_COLORS.forEach(c => {
                stmt1.run([c.type, c.hex, ...langs.map(l => S[l]?.colorNames?.[c.type] ?? null)]);
            });
            stmt1.free();

            // Leaders — union of DEFAULT_LEADERS and CURATED_COLORS keys
            const allLeaderTypes = [...new Set([
                ...Config.DEFAULT_LEADERS.map(l => l.type),
                ...Object.keys(Config.CURATED_COLORS)
            ])].sort();
            const stmt2 = db.prepare('INSERT OR IGNORE INTO Leaders VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
            allLeaderTypes.forEach(type => {
                const names = langs.map((l, i) =>
                    i === 0 ? (leaderNameFallbacks[type] ?? null) : (S[l]?.leaderNames?.[type] ?? null)
                );
                stmt2.run([type, ...names]);
            });
            stmt2.free();

            // CuratedColors
            const stmt3 = db.prepare('INSERT INTO CuratedColors VALUES (?,?,?)');
            Object.entries(Config.CURATED_COLORS).forEach(([leaderType, colorTypes]) => {
                colorTypes.forEach((colorType, i) => stmt3.run([leaderType, colorType, i]));
            });
            stmt3.free();

            const bytes = db.export();
            db.close();
            const blob = new Blob([bytes], { type: 'application/x-sqlite3' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = 'sib-content.sqlite'; a.click();
            URL.revokeObjectURL(url);
            console.log('[GameDatabase] sib-content.sqlite generated — place in data/');
        },

        _civColorToHex(str) {
            const [r, g, b] = str.split(',').map(Number);
            return '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('').toUpperCase();
        },

        _typeToName(type) {
            return type
                .replace(/^LEADER_/, '')
                .replace(/_ALT(\d*)$/, ' (Alt$1)')
                .replace(/_/g, ' ')
                .replace(/\b\w/g, c => c.toUpperCase())
                .trim();
        }
    };

    // ═══════════════════════════════════════════════════════════════
    // EXPOSED GLOBAL INIT
    // ═══════════════════════════════════════════════════════════════
    async function init() {
        const saved = localStorage.getItem('sib-color-configurator');
        if (saved) {
            try {
                const data = JSON.parse(saved);
                State.colorDefs = data.colorDefs || {};
                State.leaderSelections = data.leaderSelections || {};
                State.customColors = data.customColors || [];
                State.customRandomPool = data.customRandomPool || [];
                if (data.darkMode) {
                    document.documentElement.setAttribute('data-dark', '');
                    document.getElementById('themeToggle').innerHTML = `<img src="assets/icons/sib-cc-eye-light.png" style="width: 32px; vertical-align: middle;">`;
                } else {
                    document.documentElement.removeAttribute('data-dark'); 
                    document.getElementById('themeToggle').innerHTML = `<img src="assets/icons/sib-cc-eye-dark.png" style="width: 32px; vertical-align: middle;">`;
                }
                UI.showSessionBanner('ok', data.savedAt);
            } catch(e) { console.error('Save parsing failed', e); }
        } else {
            document.documentElement.removeAttribute('data-dark'); 
            document.getElementById('themeToggle').innerHTML = `<img src="assets/icons/sib-cc-eye-dark.png" style="width: 32px; vertical-align: middle;">`;
            UI.showSessionBanner('warn');
        }

        await GameDatabase.load();

        Config.DEFAULT_COLORS.concat(Config.SIBR3_COLORS).forEach(c => { if (!State.colorDefs[c.type]) State.colorDefs[c.type] = c.hex; });
        Config.DEFAULT_LEADERS.forEach(l => {
            if (!State.leaderSelections[l.type]) {
                State.leaderSelections[l.type] = { primary: l.defaultPrimary, secondary: l.defaultSecondary, alt1Primary: l.defaultAlt1P, alt1Secondary: l.defaultAlt1S, alt2Primary: l.defaultAlt2P, alt2Secondary: l.defaultAlt2S, alt3Primary: l.defaultAlt3P, alt3Secondary: l.defaultAlt3S };
            }
        });

        document.getElementById('themeToggle').addEventListener('click', () => {
            const isDark = document.documentElement.hasAttribute('data-dark');
            if(isDark) { document.documentElement.removeAttribute('data-dark'); document.getElementById('themeToggle').innerHTML = `<img src="assets/icons/sib-cc-eye-dark.png" style="width: 32px; vertical-align: middle;">`; }
            else { document.documentElement.setAttribute('data-dark', ''); document.getElementById('themeToggle').innerHTML = `<img src="assets/icons/sib-cc-eye-light.png" style="width: 32px; vertical-align: middle;">`; }
            persist();
        });
        
        document.getElementById('fileInput').addEventListener('change', e => {
			const file = e.target.files[0]; 
			if (!file) return;
			
			const reader = new FileReader();
			reader.onload = (ev) => {
				try {
					// Parse the JSON FIRST to ensure it is valid
					const conf = JSON.parse(ev.target.result);
					
					// Build weighted loading steps
					const lingerWeight = 15; 
					const baseSteps = [
						...Array(lingerWeight).fill(`${t('tabColors')} - ${t('labelCustomColorSection')}`),
						...Array(lingerWeight).fill(`${t('tabColors')} - ${t('labelSibreColorSection')}`),
						...Array(lingerWeight).fill(`${t('tabColors')} - ${t('labelStandardColorSection')}`)
					];
					const leaderSteps = Config.DEFAULT_LEADERS.map(l => `${t('tabLeaders')} - ${tLeader(l.type, l.name)}`);
					const processingSteps = [...baseSteps, ...leaderSteps];

					// Trigger the theatre engine
					Theater.simulateLoading(t('titleRestoringData'), 'assets/icons/sib-cc-unpack.png', processingSteps, 0, () => {
						
						// Commit the data to state only after the animation finishes
						if (conf.colorDefs) State.colorDefs = conf.colorDefs;
						if (conf.leaderSelections) State.leaderSelections = conf.leaderSelections;
						if (conf.customColors) State.customColors = conf.customColors;
						if (conf.customRandomPool) State.customRandomPool = conf.customRandomPool;
						
						persist(); 
						
						if (typeof Render !== 'undefined' && Render.colorsTable) Render.colorsTable();
						if (typeof Render !== 'undefined' && Render.leadersTable) Render.leadersTable();
						
						UI.applyStrings();
						document.getElementById('sessionBanner').style.display='none';
						UI.notify(t('notifConfigLoaded', {filename: file.name}), 'success');
					});
					
				} catch(err) { 
					UI.notify(t('notifConfigError', {error: err.message}), 'error'); 
				}
			};
			reader.readAsText(file); 
			e.target.value = ''; // Reset the input so the same file can be loaded again if needed
		});

        document.getElementById('modFileInput').addEventListener('change', e => {
			const file = e.target.files[0]; 
			if (!file) return;
			
			const reader = new FileReader();
			reader.onload = (ev) => {
				try {
					const content = ev.target.result;
					const isXml = file.name.toLowerCase().endsWith('.xml');
					
					const processingSteps = [t('tabColors'), t('tabLeaders')];

					Theater.simulateLoading(t('titleImportingMod') || "Importing Mod...", 'assets/icons/sib-cc-unpack.png', processingSteps, 0, () => {
						const results = isXml ? ExternalImport.parseXML(content) : ExternalImport.parseSQL(content);
						ExternalImport.applyParsedData(results);
						
						persist(); 
						if (typeof Render !== 'undefined' && Render.colorsTable) Render.colorsTable();
						if (typeof Render !== 'undefined' && Render.leadersTable) Render.leadersTable();
						UI.applyStrings();
						document.getElementById('sessionBanner').style.display='none';
						UI.notify(t('notifModImported', {filename: file.name}), 'success');
					});
				} catch(err) { 
					UI.notify(t('notifModError', {error: err.message}), 'error'); 
				}
			};
			reader.readAsText(file); 
			reader.readAsText(file); 
			e.target.value = ''; 
		});
        document.getElementById('btnBannerDismiss').addEventListener('click', () => document.getElementById('sessionBanner').style.display='none');
		
        // 1. Listen for the user picking files in the new modal
        document.getElementById('advancedImportFileInput').addEventListener('change', async (e) => {
            const files = Array.from(e.target.files);
            if (files.length === 0) return;

            const combinedData = { colors: {}, leaders: {} };

            // Read all selected files simultaneously 
            for (const file of files) {
                const text = await file.text();
                const isXml = file.name.toLowerCase().endsWith('.xml');
                const results = isXml ? ExternalImport.parseXML(text) : ExternalImport.parseSQL(text);
                
                Object.assign(combinedData.colors, results.colors);
                Object.assign(combinedData.leaders, results.leaders);
            }

            // Clean up duplicates across all imported files before rendering
            const finalCleanData = ExternalImport.collapseDuplicates(combinedData);

            ImportStaging.render(finalCleanData);
            e.target.value = ''; // Reset input so they can pick the same files again if needed
        });

        // 2. Handle Checkbox Toggles & Dependencies within the modal
        document.getElementById('advancedImportModal').addEventListener('change', e => {
            if (e.target.id === 'masterStagingColorsCb') {
                document.querySelectorAll('.staging-color-cb').forEach(cb => cb.checked = e.target.checked);
            } else if (e.target.id === 'masterStagingLeadersCb') {
                document.querySelectorAll('.staging-leader-cb').forEach(cb => cb.checked = e.target.checked);
            }
            
            if (e.target.classList.contains('staging-cb') || e.target.name === 'importMode' || e.target.id.startsWith('masterStaging')) {
                ImportStaging.evaluateDependencies();
            }
        });

        // 3. Handle the final Confirm Import click
        document.getElementById('btnConfirmAdvancedImport').addEventListener('click', () => {
            const filteredData = ImportStaging.getFilteredData();
            const mode = document.querySelector('input[name="importMode"]:checked').value;

            Theater.simulateLoading(t('titleImportingMod') || "Merging Configuration...", 'assets/icons/sib-cc-unpack.png', ["Processing Data..."], 0, () => {
                
                if (mode === 'replace') {
                    State.customColors = [];
                    State.customRandomPool = [];
                    Config.DEFAULT_LEADERS.forEach(l => {
                        State.leaderSelections[l.type] = { 
                            primary: l.defaultPrimary, secondary: l.defaultSecondary, 
                            alt1Primary: l.defaultAlt1P, alt1Secondary: l.defaultAlt1S, 
                            alt2Primary: l.defaultAlt2P, alt2Secondary: l.defaultAlt2S, 
                            alt3Primary: l.defaultAlt3P, alt3Secondary: l.defaultAlt3S 
                        };
                    });
                }

                ExternalImport.applyParsedData(filteredData);
                
                persist(); 
                if (typeof Render !== 'undefined' && Render.colorsTable) Render.colorsTable();
                if (typeof Render !== 'undefined' && Render.leadersTable) Render.leadersTable();
                UI.applyStrings();
                
                UI.closeModal('advancedImportModal');
                document.getElementById('importStagingArea').style.display = 'none';
                UI.notify(`Imported ${Object.keys(filteredData.colors).length} colors and ${Object.keys(filteredData.leaders).length} leaders.`, 'success');
            });
        });
		
        // Auto-generate the Mod ID as the user types the Mod Name
        document.getElementById('exportModName').addEventListener('input', (e) => {
            const idInput = document.getElementById('exportModId');
            // Lowercase, replace spaces/underscores with hyphens, strip all non-alphanumeric characters
            let slug = e.target.value.toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '');
            // Ensure it doesn't end with a hyphen
            slug = slug.replace(/-+$/, '');
            idInput.value = slug || 'custom-color-mod'; // Fallback if empty
        });

       document.getElementById('btnConfirmWorkshopExport').addEventListener('click', async (e) => {
            const btn = e.target;
            
            btn.disabled = true;
            const originalText = btn.innerHTML;
            btn.innerHTML = 'Translating...';

            const details = {
                name: document.getElementById('exportModName').value.trim() || 'Custom Colors',
                id: document.getElementById('exportModId').value.trim() || 'custom-colors',
                author: document.getElementById('exportModAuthor').value.trim() || 'Unknown Author',
                version: document.getElementById('exportModVersion').value.trim() || '1.0',
                description: document.getElementById('exportModDesc').value.trim() || 'Custom colors.',
                autoTranslate: document.getElementById('exportAutoTranslate').checked,
                
                // THE FIX: Automatically map the current UI language to the Civ 7 locale tag
                locale: WorkshopExport._mapAppLangToCivLocale(State.lang) 
            };

            const finalSqlString = IO.generateCombinedSQL(); 
            
            await WorkshopExport.downloadZip(finalSqlString, details);
            
            btn.disabled = false;
            btn.innerHTML = originalText;
            UI.closeModal('exportWorkshopModal');
        });
		
        // Detect starting language
        const savedLang  = localStorage.getItem('sib-color-configurator_lang');
        const mapped = localeToLangKey(savedLang) || localeToLangKey(navigator.language) || 'en';
        State.lang = Locale.STRINGS[mapped] ? mapped : 'en';

        Events.init();
        UI.applyStrings();
        Events.switchTab('leaders');

		// Migration utility — open with ?migrate=1 to generate sib-content.sqlite from bundled JS data
		if (new URLSearchParams(window.location.search).has('migrate')) {
			GameDatabase.generate();
		}

		// Page counter
		const COUNTER_URL = 'https://sib-cc-counter.nathankearns.workers.dev/';
		const el = document.getElementById('visitorCount');
		
		if (sessionStorage.getItem('sib-cc-counted')) {
		    // Already counted this session — restore from cache
		    if (el) el.textContent = Number(sessionStorage.getItem('sib-cc-count')).toLocaleString();
		} else {
		    fetch(COUNTER_URL)
		        .then(r => r.ok ? r.json() : Promise.reject())
		        .then(data => {
		            sessionStorage.setItem('sib-cc-counted', '1');
		            sessionStorage.setItem('sib-cc-count', data.count);
		            if (el && data.count) el.textContent = data.count.toLocaleString();
		        })
		        .catch(() => {
		            if (el) el.closest('.visitor-counter').style.display = 'none';
		        });
		}

    }

    return { 
        init, 
        applyAuto: (leader, method) => {
            // Conditionally build the steps based on the method
            const processingSteps = method === 'theory'
                ? ['labelAlt1', 'labelAlt2', 'labelAlt3']
                : ['labelMain', 'labelAlt1', 'labelAlt2', 'labelAlt3'];
            
            // Trigger the Theatre
            Theater.simulateLoading(t('titleGeneratingColors'), 'assets/icons/sib-cc-wizard.png', processingSteps.map(t), 0, () => {
                
                let res;
                if(method === 'curated') res = AutoGen.generateCurated(leader);
                if(method === 'all') res = AutoGen.generateRandomAll(leader);
                if(method === 'default') res = AutoGen._generateFromPool(Config.DEFAULT_COLORS.map(c=>c.type), leader);
                if(method === 'custom') res = AutoGen.generateCustom(leader);
                if(method === 'theory') res = AutoGen.generateAltsFrom(State.leaderSelections[leader].primary, State.leaderSelections[leader].secondary);
                
                if(res) { 
                    Object.assign(State.leaderSelections[leader], res); 
                    persist(); 
                    Render.leadersTable(); 
					UI.closeModal('autoGenModal');
                    
                    const methodNames = {
                        'curated': t('autoMethodCurated'), 'default': t('autoMethodDefault'),
                        'custom': t('autoMethodCustom'), 'all': t('autoMethodAll'), 'theory': t('autoMethodTheory')
                    };
                    
                    UI.notify(t('notifAutoApplied', { 
                        method: methodNames[method], 
                        leader: tLeader(leader, Config.DEFAULT_LEADERS.find(l=>l.type===leader).name) 
                    }), 'success');
                }
                
            });
        },
        applyBulkAuto: (method) => {
            const leaderNames = Config.DEFAULT_LEADERS.map(l => tLeader(l.type, l.name));
			Theater.simulateLoading(t('titleGeneratingColors'), 'assets/icons/sib-cc-wizard.png', leaderNames, 0, () => {
				let count = 0;
				Config.DEFAULT_LEADERS.forEach(l => {
					let res;
					if(method === 'curated') res = AutoGen.generateCurated(l.type);
					if(method === 'all') res = AutoGen.generateRandomAll(l.type);
					if(method === 'default') res = AutoGen._generateFromPool(Config.DEFAULT_COLORS.map(c=>c.type), l.type);
					if(method === 'custom') res = AutoGen.generateCustom(l.type);
					if(method === 'theory') res = AutoGen.generateAltsFrom(State.leaderSelections[l.type].primary, State.leaderSelections[l.type].secondary);
					
					if(res) { Object.assign(State.leaderSelections[l.type], res); count++; }
				});
				persist(); Render.leadersTable(); UI.closeModal('bulkAutoModal');
				
				const methodNames = {
					'curated': t('autoMethodCurated'), 'default': t('autoMethodDefault'),
					'custom': t('autoMethodCustom'), 'all': t('autoMethodAll'), 'theory': t('autoMethodTheory')
				};
				UI.notify(t('notifBulkApplied', { method: methodNames[method], count: count }), 'success');
			});
        }
    };
})();

// Boot app
window.addEventListener('DOMContentLoaded', SiBr3Configurator.init);
