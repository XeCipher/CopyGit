import { Component, OnInit, OnDestroy, Inject, HostListener } from '@angular/core';
import { DOCUMENT, CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription, forkJoin } from 'rxjs';
import {
  ApiService,
  RepoNode,
  RepoInfo,
  CommitInfo,
  AnalyzeResponse
} from './services/api.service';
import { TreeNodeComponent } from './components/tree-node/tree-node.component';

type ErrorCode =
  | 'private'
  | 'not_found'
  | 'lacks_permission'
  | 'invalid_token'
  | 'rate_limited'
  | 'forbidden'
  | 'unknown'
  | '';

interface ParsedInputUrl {
  owner: string;
  repo: string;
  branchHint: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, TreeNodeComponent],
  templateUrl: './app.component.html',
})
export class AppComponent implements OnInit, OnDestroy {

  // ── Theme ──
  isDark = false;

  // ── Token ──
  showTokenModal = false;
  githubToken = '';
  tokenSaved = false;
  showTokenValue = false;

  // ── URL / Branch ──
  repoUrl = '';
  branchName = '';
  branches: string[] = [];
  fetchingBranches = false;
  repoInfo: RepoInfo | null = null;
  repoError: ErrorCode = '';
  repoErrorMessage = '';
  isPrivateDetected = false;
  private urlDebounce: ReturnType<typeof setTimeout> | null = null;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private copyTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Latest Commit ──
  latestCommit: CommitInfo | null = null;
  fetchingCommit = false;

  // ── Tree / Analysis ──
  loading = false;
  repoStructure: RepoNode[] | null = null;
  _filteredStructure: RepoNode[] | null = null;
  repoPath = '';
  repoName = '';
  owner = '';
  branch = '';
  analyzedCommitSha = '';
  searchQuery = '';
  treeTruncated = false;
  emptyRepo = false;
  expandRevision = 0;
  allExpanded = false;
  justRefreshed = false;
  private lastAnalyzedKey = '';

  // Cached selection metrics updated on tree mutations (O(1) reads in template)
  totalFileCount = 0;
  selectedFileCount = 0;
  selectedTotalBytes = 0;

  // ── Output ──
  generatingText = false;
  finalText = '';
  charCount = 0;
  tokenCount = 0;
  fileCount = 0;
  skippedFiles: string[] = [];
  copyBtnText = 'Copy';
  copied = false;
  actionError = '';

  // ── Preview & Responsive ──
  showFullPreview = false;
  isLoadingFullPreview = false;
  mobileTab: 'files' | 'output' = 'files';

  // ── Active Subscriptions ──
  private repoInfoSub?: Subscription;
  private commitSub?: Subscription;
  private analyzeSub?: Subscription;
  private processSub?: Subscription;

  constructor(
    private api: ApiService,
    @Inject(DOCUMENT) private document: Document
  ) {}

  ngOnInit() {
    const saved = localStorage.getItem('copygit_theme');
    if (saved) {
      this.isDark = saved === 'dark';
    } else {
      this.isDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
    }
    this.applyTheme();

    const tok = localStorage.getItem('copygit_github_token');
    if (tok) {
      this.githubToken = tok;
      this.tokenSaved = true;
    }

    window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', e => {
      if (!localStorage.getItem('copygit_theme')) {
        this.isDark = e.matches;
        this.applyTheme();
      }
    });
  }

  ngOnDestroy() {
    if (this.urlDebounce) clearTimeout(this.urlDebounce);
    if (this.syncTimer) clearTimeout(this.syncTimer);
    if (this.copyTimer) clearTimeout(this.copyTimer);
    this.repoInfoSub?.unsubscribe();
    this.commitSub?.unsubscribe();
    this.analyzeSub?.unsubscribe();
    this.processSub?.unsubscribe();
  }

  @HostListener('document:keydown.escape')
  onEscapePress() {
    if (this.showTokenModal) {
      this.showTokenModal = false;
    }
  }

  // ── THEME ──
  toggleTheme() {
    this.isDark = !this.isDark;
    localStorage.setItem('copygit_theme', this.isDark ? 'dark' : 'light');
    this.applyTheme();
  }

  private applyTheme() {
    this.document.documentElement.classList.toggle('dark', this.isDark);
  }

  // ── TOKEN ──
  saveToken() {
    const t = this.githubToken.trim();
    if (!t) return;

    localStorage.setItem('copygit_github_token', t);
    this.tokenSaved = true;
    this.githubToken = t;
    this.showTokenModal = false;

    if (this.repoUrl && (this.isPrivateDetected || this.repoError || !this.repoInfo)) {
      this.fetchRepoInfo();
    }
  }

  clearToken() {
    this.githubToken = '';
    this.tokenSaved = false;
    localStorage.removeItem('copygit_github_token');
    if (this.repoError === 'invalid_token' || this.repoError === 'lacks_permission') {
      this.repoError = '';
      this.repoErrorMessage = '';
      if (this.parseUrlInput(this.repoUrl)) {
        this.fetchRepoInfo();
      }
    }
  }

  // ── URL PARSING & HELPERS ──
  parseUrlInput(rawUrl: string): ParsedInputUrl | null {
    const cleaned = rawUrl.trim();
    if (!cleaned) return null;

    const match = cleaned.match(/(?:^|\/\/|@|www\.)github\.com[:/]([^/\s]+)\/([^/\s?#]+)/i);
    if (!match) return null;

    const owner = match[1];
    const repo = match[2].replace(/\.git$/i, '');
    if (!owner || !repo) return null;

    let branchHint = '';
    const treeMatch = cleaned.match(/github\.com\/[^/]+\/[^/]+\/tree\/([^?#]+)/i);
    if (treeMatch && treeMatch[1]) {
      branchHint = decodeURIComponent(treeMatch[1]).replace(/\/+$/, '');
    }

    return { owner, repo, branchHint };
  }

  get isUrlValid(): boolean {
    return this.parseUrlInput(this.repoUrl) !== null;
  }

  useExampleRepo(url: string) {
    this.repoUrl = url;
    this.onUrlChange(0);
  }

  clearUrl() {
    if (this.urlDebounce) clearTimeout(this.urlDebounce);
    this.repoInfoSub?.unsubscribe();
    this.commitSub?.unsubscribe();
    this.repoUrl = '';
    this.branchName = '';
    this.branches = [];
    this.repoInfo = null;
    this.repoError = '';
    this.repoErrorMessage = '';
    this.actionError = '';
    this.isPrivateDetected = false;
    this.latestCommit = null;
    this.fetchingBranches = false;
    this.fetchingCommit = false;
  }

  // ── URL & BRANCH CHANGE ──
  onUrlChange(delayMs = 450) {
    if (this.urlDebounce) clearTimeout(this.urlDebounce);
    this.repoInfoSub?.unsubscribe();
    this.commitSub?.unsubscribe();

    this.repoError = '';
    this.repoErrorMessage = '';
    this.actionError = '';
    this.isPrivateDetected = false;
    this.repoInfo = null;
    this.branches = [];
    this.branchName = '';
    this.latestCommit = null;
    this.fetchingBranches = false;
    this.fetchingCommit = false;

    const parsed = this.parseUrlInput(this.repoUrl);
    if (!parsed) return;

    if (delayMs === 0) {
      this.fetchRepoInfo();
    } else {
      this.urlDebounce = setTimeout(() => this.fetchRepoInfo(), delayMs);
    }
  }

  onUrlPaste() {
    // Allow ngModel to update on the next tick, then fetch promptly without long typing delay
    setTimeout(() => this.onUrlChange(80), 0);
  }

  onUrlEnter() {
    if (!this.isUrlValid || this.loading) return;
    if (this.urlDebounce) clearTimeout(this.urlDebounce);

    if (this.branchName && this.repoInfo) {
      this.onAnalyze();
    } else {
      this.fetchRepoInfo(true);
    }
  }

  fetchRepoInfo(autoAnalyze = false) {
    const parsed = this.parseUrlInput(this.repoUrl);
    if (!parsed) return;

    this.repoInfoSub?.unsubscribe();
    this.fetchingBranches = true;
    this.repoError = '';
    this.repoErrorMessage = '';

    this.repoInfoSub = this.api.getRepoInfo(this.repoUrl, this.githubToken || undefined).subscribe({
      next: res => {
        this.branches = res.branches;
        this.repoInfo = res;
        this.fetchingBranches = false;
        this.repoError = '';
        this.repoErrorMessage = '';
        this.isPrivateDetected = false;

        // Pick branch from URL /tree/<branch> hint if present, otherwise default branch
        const matchedHint = parsed.branchHint
          ? [...res.branches]
              .sort((a, b) => b.length - a.length)
              .find(b => parsed.branchHint === b || parsed.branchHint.startsWith(`${b}/`))
          : undefined;

        this.branchName = matchedHint || res.default_branch;

        if (autoAnalyze) {
          this.onAnalyze();
        } else {
          this.fetchLatestCommit();
        }
      },
      error: err => {
        this.fetchingBranches = false;
        this.handleRepoInfoError(err);
      }
    });
  }

  private handleRepoInfoError(err: any) {
    const code = err?.error?.code || '';
    const msg = err?.error?.error || 'Could not load repository information.';
    this.repoErrorMessage = msg;

    if (code === 'PRIVATE_OR_LACKS_PERMISSION') {
      this.repoError = this.githubToken ? 'lacks_permission' : 'private';
      this.isPrivateDetected = true;
    } else if (code === 'INVALID_TOKEN') {
      this.repoError = 'invalid_token';
    } else if (code === 'FORBIDDEN') {
      this.repoError = 'forbidden';
    } else if (code === 'RATE_LIMITED') {
      this.repoError = 'rate_limited';
    } else if (err?.status === 404 || code === 'NOT_FOUND') {
      this.repoError = 'not_found';
    } else {
      this.repoError = 'unknown';
    }
  }

  onBranchChange() {
    this.actionError = '';
    this.fetchLatestCommit();
  }

  fetchLatestCommit() {
    if (!this.repoUrl || !this.branchName) return;

    this.commitSub?.unsubscribe();
    this.fetchingCommit = true;

    this.commitSub = this.api.getLatestCommit(this.repoUrl, this.branchName, this.githubToken || undefined).subscribe({
      next: res => {
        this.latestCommit = res;
        this.fetchingCommit = false;
      },
      error: err => {
        this.fetchingCommit = false;
        const code = err?.error?.code || '';
        if (code === 'LACKS_CONTENTS_PERMISSION') {
          this.repoError = 'lacks_permission';
        } else if (code === 'RATE_LIMITED') {
          this.repoError = 'rate_limited';
          this.repoErrorMessage = err?.error?.error || '';
        }
      }
    });
  }

  // ── ANALYZE (Refreshes repo info, latest commit, tree, and open bundle) ──
  onAnalyze() {
    const parsed = this.parseUrlInput(this.repoUrl);
    if (!parsed || this.loading) return;

    if (this.urlDebounce) clearTimeout(this.urlDebounce);

    // If branches haven't finished loading yet (e.g. instant click after paste), load info first
    if (!this.branchName) {
      this.fetchRepoInfo(true);
      return;
    }

    const targetKey = `${parsed.owner.toLowerCase()}/${parsed.repo.toLowerCase()}#${this.branchName}`;
    const isSameTarget = this.repoStructure !== null && this.lastAnalyzedKey === targetKey;
    const hadBundle = Boolean(this.finalText);

    let prevSelectedPaths: Set<string> | null = null;
    let wasAllSelected = true;

    if (isSameTarget && this.repoStructure) {
      wasAllSelected = this.totalFileCount > 0 && this.selectedFileCount === this.totalFileCount;
      if (!wasAllSelected) {
        prevSelectedPaths = new Set(this.collectFiles(this.repoStructure));
      }
    }

    this.repoInfoSub?.unsubscribe();
    this.commitSub?.unsubscribe();
    this.analyzeSub?.unsubscribe();
    this.processSub?.unsubscribe();

    this.loading = true;
    this.fetchingCommit = true;
    this.actionError = '';
    this.repoError = '';
    this.repoErrorMessage = '';
    this.justRefreshed = false;

    if (!isSameTarget) {
      this.finalText = '';
      this.charCount = 0;
      this.tokenCount = 0;
      this.fileCount = 0;
      this.skippedFiles = [];
      this.repoStructure = null;
      this._filteredStructure = null;
      this.mobileTab = 'files';
    }

    this.showFullPreview = false;

    const token = this.githubToken || undefined;
    const requestedBranch = this.branchName;

    this.analyzeSub = forkJoin({
      info: this.api.getRepoInfo(this.repoUrl, token),
      analysis: this.api.analyzeRepo(this.repoUrl, requestedBranch, token)
    }).subscribe({
      next: ({ info, analysis }) => {
        // Refresh repo metadata and branch list while preserving the user's selected branch
        this.repoInfo = info;
        this.branches = info.branches;
        if (info.branches.includes(requestedBranch)) {
          this.branchName = requestedBranch;
        } else {
          this.branchName = info.default_branch;
        }

        this.applyAnalysisResult(analysis, targetKey, isSameTarget, wasAllSelected, prevSelectedPaths, hadBundle);
      },
      error: err => {
        this.loading = false;
        this.fetchingCommit = false;
        this.handleAnalyzeError(err);
      }
    });
  }

  private applyAnalysisResult(
    res: AnalyzeResponse,
    targetKey: string,
    isSameTarget: boolean,
    wasAllSelected: boolean,
    prevSelectedPaths: Set<string> | null,
    hadBundle: boolean
  ) {
    this.repoStructure = res.structure;
    this.repoPath = res.repo_path;
    this.repoName = res.repo_name;
    this.owner = res.owner;
    this.branch = res.branch || this.branchName;
    this.analyzedCommitSha = res.commit_sha || '';
    this.treeTruncated = Boolean(res.truncated);
    this.emptyRepo = Boolean(res.empty);
    this.lastAnalyzedKey = targetKey;

    if (res.latest_commit) {
      this.latestCommit = res.latest_commit;
    }
    this.fetchingCommit = false;

    if (isSameTarget && !wasAllSelected && prevSelectedPaths) {
      this.restoreSelection(this.repoStructure, prevSelectedPaths);
    } else {
      this.setTreeSelection(this.repoStructure, true);
    }

    this.allExpanded = false;
    this.expandRevision++;
    this.onSearchChange();
    this.syncMetrics();

    this.loading = false;
    this.triggerSyncedBadge();

    // When re-analyzing the same repo & branch with an existing bundle open, refresh the code bundle too
    if (isSameTarget && hadBundle) {
      if (this.selectedFileCount > 0) {
        this.generateText(true);
      } else {
        this.finalText = '';
        this.charCount = 0;
        this.tokenCount = 0;
        this.fileCount = 0;
        this.skippedFiles = [];
      }
    }
  }

  private handleAnalyzeError(err: any) {
    const code = err?.error?.code || '';
    const msg = err?.error?.error || 'Failed to analyze repository. Please check the URL and try again.';

    if (code === 'PRIVATE_OR_LACKS_PERMISSION') {
      this.repoError = this.githubToken ? 'lacks_permission' : 'private';
      this.isPrivateDetected = true;
      if (!this.githubToken) this.showTokenModal = true;
    } else if (code === 'LACKS_CONTENTS_PERMISSION') {
      this.repoError = 'lacks_permission';
      this.showTokenModal = true;
    } else if (code === 'INVALID_TOKEN') {
      this.repoError = 'invalid_token';
    } else if (code === 'RATE_LIMITED') {
      this.repoError = 'rate_limited';
      this.repoErrorMessage = msg;
    } else if (code === 'FORBIDDEN') {
      this.repoError = 'forbidden';
      this.repoErrorMessage = msg;
    } else if (err?.status === 404 || code === 'NOT_FOUND') {
      this.repoError = 'not_found';
      this.repoErrorMessage = msg;
    } else {
      this.actionError = msg;
    }
  }

  private triggerSyncedBadge() {
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.justRefreshed = true;
    this.syncTimer = setTimeout(() => {
      this.justRefreshed = false;
    }, 2600);
  }

  // ── TREE SELECTION & EXPANSION ──
  selectAll(val: boolean) {
    if (!this.repoStructure) return;

    // When filtering, toggle only matching visible items so hidden files aren't unexpectedly touched
    const targetNodes = this._filteredStructure || this.repoStructure;
    this.setTreeSelection(targetNodes, val);
    this.syncMetrics();
  }

  toggleExpandAll() {
    if (!this.repoStructure) return;
    this.allExpanded = !this.allExpanded;
    const targets = this._filteredStructure || this.repoStructure;
    this.setTreeExpanded(targets, this.allExpanded);
    if (targets !== this.repoStructure) {
      this.setTreeExpanded(this.repoStructure, this.allExpanded);
    }
    this.expandRevision++;
  }

  private setTreeExpanded(nodes: RepoNode[], expanded: boolean) {
    for (const node of nodes) {
      if (node.type === 'directory') {
        node.expanded = expanded;
        if (node.children) {
          this.setTreeExpanded(node.children, expanded);
        }
      }
    }
  }

  private setTreeSelection(nodes: RepoNode[], val: boolean) {
    for (const node of nodes) {
      node.selected = val;
      if (node.children) {
        this.setTreeSelection(node.children, val);
      }
    }
  }

  private restoreSelection(nodes: RepoNode[], selectedPaths: Set<string>) {
    for (const node of nodes) {
      if (node.type === 'file') {
        node.selected = selectedPaths.has(node.path);
      } else if (node.children) {
        this.restoreSelection(node.children, selectedPaths);
      }
    }
  }

  onChildSelectionChange() {
    this.syncMetrics();
  }

  private syncMetrics() {
    if (!this.repoStructure) {
      this.totalFileCount = 0;
      this.selectedFileCount = 0;
      this.selectedTotalBytes = 0;
      return;
    }

    const metrics = this.recomputeTreeMetrics(this.repoStructure);
    this.totalFileCount = metrics.files;
    this.selectedFileCount = metrics.selected;
    this.selectedTotalBytes = metrics.bytes;

    if (this._filteredStructure && this._filteredStructure !== this.repoStructure) {
      this.recomputeTreeMetrics(this._filteredStructure);
    }
  }

  private recomputeTreeMetrics(nodes: RepoNode[]): { files: number; selected: number; bytes: number } {
    let files = 0;
    let selected = 0;
    let bytes = 0;

    for (const node of nodes) {
      if (node.type === 'file') {
        node.fileCount = 1;
        node.selectedCount = node.selected ? 1 : 0;
        node.selectedSize = node.selected ? (node.size || 0) : 0;
        files += 1;
        if (node.selected) {
          selected += 1;
          bytes += node.size || 0;
        }
      } else if (node.children) {
        const sub = this.recomputeTreeMetrics(node.children);
        node.fileCount = sub.files;
        node.selectedCount = sub.selected;
        node.selectedSize = sub.bytes;
        files += sub.files;
        selected += sub.selected;
        bytes += sub.bytes;
      } else {
        node.fileCount = 0;
        node.selectedCount = 0;
        node.selectedSize = 0;
      }
    }

    return { files, selected, bytes };
  }

  // ── GENERATE BUNDLE ──
  generateText(preserveMobileTab = false) {
    if (!this.repoStructure) return;

    const files = this.collectFiles(this.repoStructure);
    if (!files.length) {
      this.actionError = 'Select at least one file to generate a bundle.';
      return;
    }

    this.processSub?.unsubscribe();
    this.generatingText = true;
    this.showFullPreview = false;
    this.actionError = '';

    this.processSub = this.api
      .processFiles(
        this.repoPath,
        files,
        this.repoName,
        this.branch || this.branchName,
        this.owner,
        this.githubToken || undefined,
        this.analyzedCommitSha || undefined
      )
      .subscribe({
        next: res => {
          this.finalText = res.full_text;
          this.charCount = this.finalText.length;
          this.tokenCount = Math.ceil(this.finalText.length / 4);
          this.fileCount = res.file_count;
          this.skippedFiles = res.skipped || [];
          this.generatingText = false;
          if (!preserveMobileTab) {
            this.mobileTab = 'output';
          }
        },
        error: err => {
          this.generatingText = false;
          if (err?.status === 413 || err?.error?.code === 'BUNDLE_TOO_LARGE') {
            this.actionError =
              err?.error?.error ||
              'Selected bundle exceeds the 4.3 MB limit. Deselect large files and try again.';
          } else if (err?.error?.code === 'RATE_LIMITED') {
            this.repoError = 'rate_limited';
            this.repoErrorMessage = err?.error?.error || '';
          } else {
            this.actionError = err?.error?.error || 'Failed to generate bundle. Please try again.';
          }
        }
      });
  }

  private collectFiles(nodes: RepoNode[], result: string[] = []): string[] {
    for (const n of nodes) {
      if (n.type === 'file' && n.selected) {
        result.push(n.path);
      } else if (n.type === 'directory' && n.children) {
        this.collectFiles(n.children, result);
      }
    }
    return result;
  }

  // ── COPY / DOWNLOAD ──
  copyToClipboard() {
    if (!this.finalText) return;

    const markCopied = () => {
      if (this.copyTimer) clearTimeout(this.copyTimer);
      this.copied = true;
      this.copyBtnText = 'Copied!';
      this.copyTimer = setTimeout(() => {
        this.copied = false;
        this.copyBtnText = 'Copy';
      }, 2000);
    };

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(this.finalText).then(markCopied).catch(() => {
        this.fallbackCopy(markCopied);
      });
    } else {
      this.fallbackCopy(markCopied);
    }
  }

  private fallbackCopy(onSuccess: () => void) {
    const ta = this.document.createElement('textarea');
    ta.value = this.finalText;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    ta.style.opacity = '0';
    this.document.body.appendChild(ta);
    ta.select();
    try {
      this.document.execCommand('copy');
      onSuccess();
    } catch {
      this.actionError = 'Could not copy automatically. Use Download .txt instead.';
    } finally {
      this.document.body.removeChild(ta);
    }
  }

  downloadFile() {
    if (!this.finalText) return;
    const blob = new Blob([this.finalText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = this.document.createElement('a');
    a.href = url;
    const safeBranch = (this.branch || this.branchName || 'bundle').replace(/[/\\?%*:|"<>]/g, '-');
    a.download = `${this.repoName || 'copygit'}-${safeBranch}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  loadFullPreview() {
    this.isLoadingFullPreview = true;
    setTimeout(() => {
      this.showFullPreview = true;
      this.isLoadingFullPreview = false;
    }, 50);
  }

  // ── COMPUTED & HELPERS ──
  get previewText(): string {
    const MAX_PREVIEW_LENGTH = 100000;
    if (!this.showFullPreview && this.finalText.length > MAX_PREVIEW_LENGTH) {
      return (
        this.finalText.substring(0, MAX_PREVIEW_LENGTH) +
        '\n\n================================================================================\n' +
        'NOTE: Preview truncated for rendering performance.\n' +
        'Please use "Download .txt", "Copy", or click "Full Preview" to view the rest.\n' +
        '================================================================================'
      );
    }
    return this.finalText;
  }

  onSearchChange() {
    if (!this.repoStructure) {
      this._filteredStructure = null;
      return;
    }

    const q = this.searchQuery.toLowerCase().trim();
    if (!q) {
      this._filteredStructure = this.repoStructure;
      this.expandRevision++;
      this.syncMetrics();
      return;
    }

    this._filteredStructure = this.filterNodes(this.repoStructure, q);
    this.recomputeTreeMetrics(this._filteredStructure);
    this.expandRevision++;
  }

  private filterNodes(nodes: RepoNode[], q: string): RepoNode[] {
    const out: RepoNode[] = [];

    for (const n of nodes) {
      const pathMatch = n.path.toLowerCase().includes(q);
      const nameMatch = n.name.toLowerCase().includes(q);

      if (n.type === 'file') {
        if (pathMatch || nameMatch) {
          out.push(n);
        }
      } else if (n.children) {
        if (pathMatch || nameMatch) {
          out.push({ ...n, expanded: false });
        } else {
          const kids = this.filterNodes(n.children, q);
          if (kids.length > 0) {
            out.push({ ...n, children: kids, expanded: true });
          }
        }
      }
    }

    return out;
  }

  trackByNode(_index: number, node: RepoNode): string {
    return node.path;
  }

  formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  formatNum(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toString();
  }
}