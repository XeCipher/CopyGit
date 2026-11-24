import { Component, OnInit, OnDestroy, Inject, HostListener, ViewChild } from '@angular/core';
import { DOCUMENT, CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import {
  ApiService,
  RepoNode,
  RepoInfo,
  CommitInfo,
  AnalyzeResponse
} from './services/api.service';
import { RecentReposService, RecentRepo } from './services/recent-repos.service';
import { TreeNodeComponent } from './components/tree-node/tree-node.component';
import { RecentReposComponent, RepoSelectRequest } from './components/recent-repos/recent-repos.component';
import { BranchSelectorComponent } from './components/branch-selector/branch-selector.component';
import { CommitSelectorComponent, CommitSelectionEvent } from './components/commit-selector/commit-selector.component';

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
  commitHint: string;
}

const COMMIT_POLL_INTERVAL_MS = 30_000;
const FOCUS_CHECK_COOLDOWN_MS = 8_000;

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TreeNodeComponent,
    RecentReposComponent,
    BranchSelectorComponent,
    CommitSelectorComponent
  ],
  templateUrl: './app.component.html',
})
export class AppComponent implements OnInit, OnDestroy {

  @ViewChild(CommitSelectorComponent) commitSelector?: CommitSelectorComponent;

  // ── Theme ──
  isDark = false;

  // ── Token ──
  showTokenModal = false;
  githubToken = '';
  tokenSaved = false;
  showTokenValue = false;

  // ── Recent Repositories ──
  recentRepos: RecentRepo[] = [];
  activeRecentUrl = '';
  private pendingBranchFallback = false;
  private pendingFallbackFromBranch = '';

  // ── URL / Branch ──
  repoUrl = '';
  branchName = '';
  branches: string[] = [];
  fetchingBranches = false;
  repoInfo: RepoInfo | null = null;
  repoError: ErrorCode = '';
  repoErrorMessage = '';
  isPrivateDetected = false;
  branchDropdownOpen = false;
  commitDropdownOpen = false;
  private autoAnalyzingInfo = false;
  private pasteTriggered = false;
  private urlDebounce: ReturnType<typeof setTimeout> | null = null;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private copyTimer: ReturnType<typeof setTimeout> | null = null;
  private upToDateTimer: ReturnType<typeof setTimeout> | null = null;
  private themeTransitionTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Commits & Live Update Checking ──
  latestCommit: CommitInfo | null = null;
  fetchingCommit = false;
  commits: CommitInfo[] = [];
  commitsPage = 1;
  commitsHasMore = false;
  fetchingCommits = false;
  loadingMoreCommits = false;
  lookingUpCommit = false;
  commitLookupError = '';
  selectedCommitSha = '';
  pinnedCommitInfo: CommitInfo | null = null;
  private commitsLoadedForBranch = '';
  private commitsLoadingForBranch: string | null = null;

  analyzedCommitInfo: CommitInfo | null = null;
  analyzedMode: 'latest' | 'commit' = 'latest';
  baselineHeadSha = '';
  latestCommitEtag = '';
  newCommitAvailable: CommitInfo | null = null;
  dismissedNewCommitSha = '';
  checkingForNewCommits = false;
  commitCheckUpToDate = false;
  private pollingPaused = false;
  private lastCommitPollAt = 0;
  private commitPollInterval: ReturnType<typeof setInterval> | null = null;

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
  private commitsSub?: Subscription;
  private pollSub?: Subscription;
  private analyzeSub?: Subscription;
  private processSub?: Subscription;

  constructor(
    private api: ApiService,
    private recentReposService: RecentReposService,
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

    this.recentRepos = this.recentReposService.getAll();

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
    if (this.upToDateTimer) clearTimeout(this.upToDateTimer);
    if (this.themeTransitionTimer) clearTimeout(this.themeTransitionTimer);
    this.stopCommitPolling();
    this.repoInfoSub?.unsubscribe();
    this.commitSub?.unsubscribe();
    this.commitsSub?.unsubscribe();
    this.analyzeSub?.unsubscribe();
    this.processSub?.unsubscribe();
  }

  @HostListener('document:keydown.escape')
  onEscapePress() {
    if (this.showTokenModal) {
      this.showTokenModal = false;
    }
  }

  @HostListener('window:storage', ['$event'])
  onStorageChange(event: StorageEvent) {
    if (event.key === 'copygit_recent_repos' || event.key === null) {
      this.recentRepos = this.recentReposService.getAll();
    }
  }

  @HostListener('document:visibilitychange')
  onVisibilityChange() {
    if (this.document.visibilityState === 'visible') {
      this.triggerFocusCommitCheck();
    }
  }

  @HostListener('window:focus')
  onWindowFocus() {
    this.triggerFocusCommitCheck();
  }

  get anyDropdownOpen(): boolean {
    return this.branchDropdownOpen || this.commitDropdownOpen;
  }

  get showCommitSelector(): boolean {
    return Boolean(
      this.repoInfo ||
      this.branches.length > 0 ||
      this.selectedCommitSha ||
      this.fetchingBranches
    );
  }

  get displayedCommit(): CommitInfo | null {
    if (this.repoStructure !== null) {
      const currentMode: 'latest' | 'commit' = this.selectedCommitSha ? 'commit' : 'latest';
      const matchesAnalyzed =
        this.branchName === this.branch &&
        currentMode === this.analyzedMode &&
        (!this.selectedCommitSha || this.selectedCommitSha === this.analyzedCommitSha);

      if (matchesAnalyzed && this.analyzedCommitInfo) {
        return this.analyzedCommitInfo;
      }
    }

    if (this.selectedCommitSha) {
      return (
        this.pinnedCommitInfo ||
        this.commits.find(c => c.sha === this.selectedCommitSha) ||
        this.latestCommit
      );
    }

    return this.latestCommit;
  }

  // ── THEME ──
  toggleTheme() {
    this.isDark = !this.isDark;
    localStorage.setItem('copygit_theme', this.isDark ? 'dark' : 'light');
    this.document.documentElement.classList.add('theme-transitioning');
    this.applyTheme();
    if (this.themeTransitionTimer) clearTimeout(this.themeTransitionTimer);
    this.themeTransitionTimer = setTimeout(() => {
      this.document.documentElement.classList.remove('theme-transitioning');
    }, 250);
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
    this.pollingPaused = false;
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

  // ── RECENT REPOSITORIES ──
  openRecentOrExampleRepo(req: RepoSelectRequest) {
    if (this.loading && this.activeRecentUrl.toLowerCase() === req.url.toLowerCase()) {
      return;
    }

    if (this.urlDebounce) {
      clearTimeout(this.urlDebounce);
      this.urlDebounce = null;
    }

    this.stopCommitPolling();
    this.repoInfoSub?.unsubscribe();
    this.commitSub?.unsubscribe();
    this.commitsSub?.unsubscribe();
    this.analyzeSub?.unsubscribe();
    this.processSub?.unsubscribe();

    this.pasteTriggered = false;
    this.loading = false;
    this.autoAnalyzingInfo = false;
    this.fetchingBranches = false;
    this.fetchingCommit = false;
    this.fetchingCommits = false;
    this.loadingMoreCommits = false;
    this.branchDropdownOpen = false;
    this.commitDropdownOpen = false;

    this.repoError = '';
    this.repoErrorMessage = '';
    this.actionError = '';
    this.isPrivateDetected = false;
    this.repoInfo = null;
    this.latestCommit = null;
    this.resetCommitSelectionState();
    this.resetPollingState();

    this.repoUrl = req.url;
    this.branchName = req.branch || '';
    this.branches = req.branch ? [req.branch] : [];

    this.activeRecentUrl = req.url;
    this.pendingBranchFallback = Boolean(req.isRecent && req.branch);
    this.pendingFallbackFromBranch = req.branch || '';

    this.runAnalyze();
  }

  removeRecentRepo(repo: RecentRepo) {
    this.recentRepos = this.recentReposService.remove(repo.fullName);
  }

  clearRecentRepos() {
    this.recentRepos = this.recentReposService.clear();
  }

  // ── HOME RESET & URL HELPERS ──
  resetToHome() {
    if (this.urlDebounce) {
      clearTimeout(this.urlDebounce);
      this.urlDebounce = null;
    }
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }
    if (this.upToDateTimer) {
      clearTimeout(this.upToDateTimer);
      this.upToDateTimer = null;
    }

    this.stopCommitPolling();
    this.repoInfoSub?.unsubscribe();
    this.commitSub?.unsubscribe();
    this.commitsSub?.unsubscribe();
    this.analyzeSub?.unsubscribe();
    this.processSub?.unsubscribe();

    this.pasteTriggered = false;
    this.repoUrl = '';
    this.branchName = '';
    this.branches = [];
    this.fetchingBranches = false;
    this.autoAnalyzingInfo = false;
    this.repoInfo = null;
    this.repoError = '';
    this.repoErrorMessage = '';
    this.isPrivateDetected = false;
    this.branchDropdownOpen = false;
    this.commitDropdownOpen = false;
    this.activeRecentUrl = '';
    this.pendingBranchFallback = false;
    this.pendingFallbackFromBranch = '';

    this.latestCommit = null;
    this.fetchingCommit = false;
    this.resetCommitSelectionState();
    this.resetPollingState();

    this.loading = false;
    this.repoStructure = null;
    this._filteredStructure = null;
    this.repoPath = '';
    this.repoName = '';
    this.owner = '';
    this.branch = '';
    this.analyzedCommitSha = '';
    this.analyzedCommitInfo = null;
    this.analyzedMode = 'latest';
    this.searchQuery = '';
    this.treeTruncated = false;
    this.emptyRepo = false;
    this.expandRevision = 0;
    this.allExpanded = false;
    this.justRefreshed = false;
    this.lastAnalyzedKey = '';

    this.totalFileCount = 0;
    this.selectedFileCount = 0;
    this.selectedTotalBytes = 0;

    this.clearOutput();
    this.generatingText = false;
    this.actionError = '';
    this.mobileTab = 'files';
    this.showTokenModal = false;
    this.showTokenValue = false;

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

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

    let commitHint = '';
    const commitMatch = cleaned.match(/github\.com\/[^/]+\/[^/]+\/commit\/([0-9a-f]{4,40})/i);
    if (commitMatch && commitMatch[1]) {
      commitHint = commitMatch[1].toLowerCase();
    }

    return { owner, repo, branchHint, commitHint };
  }

  get isUrlValid(): boolean {
    return this.parseUrlInput(this.repoUrl) !== null;
  }

  clearUrl() {
    if (this.urlDebounce) {
      clearTimeout(this.urlDebounce);
      this.urlDebounce = null;
    }
    this.stopCommitPolling();
    this.repoInfoSub?.unsubscribe();
    this.commitSub?.unsubscribe();
    this.commitsSub?.unsubscribe();
    if (this.autoAnalyzingInfo) {
      this.loading = false;
      this.autoAnalyzingInfo = false;
    }
    this.pasteTriggered = false;
    this.repoUrl = '';
    this.branchName = '';
    this.branches = [];
    this.repoInfo = null;
    this.repoError = '';
    this.repoErrorMessage = '';
    this.actionError = '';
    this.isPrivateDetected = false;
    this.branchDropdownOpen = false;
    this.commitDropdownOpen = false;
    this.latestCommit = null;
    this.fetchingBranches = false;
    this.fetchingCommit = false;
    this.resetCommitSelectionState();
    this.resetPollingState();
    this.activeRecentUrl = '';
    this.pendingBranchFallback = false;
    this.pendingFallbackFromBranch = '';
  }

  // ── URL & BRANCH CHANGE ──
  onUrlChange(inputEvent?: Event) {
    let delayMs = 450;

    if (this.pasteTriggered) {
      this.pasteTriggered = false;
      delayMs = 80;
    } else if (inputEvent && 'inputType' in inputEvent) {
      // Mobile keyboards and autofill chips often paste via inputType without firing paste
      const ie = inputEvent as InputEvent;
      const isPasteLike =
        ie.inputType === 'insertFromPaste' ||
        ie.inputType === 'insertReplacementText' ||
        (typeof ie.data === 'string' && ie.data.length > 5);
      if (isPasteLike) {
        delayMs = 80;
      }
    }

    this.scheduleUrlLookup(delayMs);
  }

  onUrlPaste() {
    this.pasteTriggered = true;
    // Fallback if a browser dispatches paste without a follow-up input event
    setTimeout(() => {
      if (this.pasteTriggered) {
        this.pasteTriggered = false;
        this.scheduleUrlLookup(80);
      }
    }, 0);
  }

  private scheduleUrlLookup(delayMs: number) {
    if (this.urlDebounce) clearTimeout(this.urlDebounce);
    this.stopCommitPolling();
    this.repoInfoSub?.unsubscribe();
    this.commitSub?.unsubscribe();
    this.commitsSub?.unsubscribe();
    if (this.autoAnalyzingInfo) {
      this.loading = false;
      this.autoAnalyzingInfo = false;
    }

    this.repoError = '';
    this.repoErrorMessage = '';
    this.actionError = '';
    this.isPrivateDetected = false;
    this.branchDropdownOpen = false;
    this.commitDropdownOpen = false;
    this.repoInfo = null;
    this.branches = [];
    this.branchName = '';
    this.latestCommit = null;
    this.fetchingBranches = false;
    this.fetchingCommit = false;
    this.resetCommitSelectionState();
    this.resetPollingState();
    this.activeRecentUrl = '';
    this.pendingBranchFallback = false;
    this.pendingFallbackFromBranch = '';

    const parsed = this.parseUrlInput(this.repoUrl);
    if (!parsed) return;

    if (delayMs === 0) {
      this.fetchRepoInfo();
    } else {
      this.urlDebounce = setTimeout(() => this.fetchRepoInfo(), delayMs);
    }
  }

  onUrlEnter() {
    if (!this.isUrlValid || this.loading) return;
    if (this.urlDebounce) clearTimeout(this.urlDebounce);

    this.activeRecentUrl = '';
    this.pendingBranchFallback = false;
    this.pendingFallbackFromBranch = '';

    if (this.branchName && this.repoInfo) {
      this.runAnalyze();
    } else {
      this.fetchRepoInfo(true);
    }
  }

  fetchRepoInfo(autoAnalyze = false) {
    const parsed = this.parseUrlInput(this.repoUrl);
    if (!parsed) return;

    this.repoInfoSub?.unsubscribe();
    this.fetchingBranches = true;
    this.autoAnalyzingInfo = autoAnalyze;
    if (autoAnalyze) {
      this.loading = true;
    }
    this.repoError = '';
    this.repoErrorMessage = '';

    // Prefetch default branch commits in parallel with repo-info when no branch hint is specified
    const prefetchedDefaultCommits = !autoAnalyze && !parsed.branchHint;
    if (prefetchedDefaultCommits) {
      this.loadBranchCommits(1, false, '');
    }

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

        if (parsed.commitHint && !this.selectedCommitSha) {
          this.selectedCommitSha = parsed.commitHint;
        }

        if (autoAnalyze) {
          this.loading = false;
          this.autoAnalyzingInfo = false;
          this.runAnalyze(true);
        } else {
          if (prefetchedDefaultCommits && !matchedHint) {
            if (this.commitsLoadedForBranch === '' && (this.commits.length > 0 || this.latestCommit?.empty)) {
              this.commitsLoadedForBranch = res.default_branch;
            }
          } else {
            this.loadBranchCommits(1, false);
          }

          if (parsed.commitHint) {
            this.resolveHintedCommit(parsed.commitHint);
          }
        }
      },
      error: err => {
        this.fetchingBranches = false;
        if (this.autoAnalyzingInfo) {
          this.loading = false;
          this.autoAnalyzingInfo = false;
        }
        this.activeRecentUrl = '';
        this.handleRepoInfoError(err);
      }
    });
  }

  private resolveHintedCommit(shaHint: string) {
    if (!this.repoUrl || !shaHint) return;
    this.commitSub?.unsubscribe();
    this.fetchingCommit = true;

    this.commitSub = this.api
      .getLatestCommit(this.repoUrl, this.branchName, this.githubToken || undefined, shaHint)
      .subscribe({
        next: commit => {
          this.fetchingCommit = false;
          if (!commit.empty && commit.sha) {
            this.selectedCommitSha = commit.sha;
            this.pinnedCommitInfo = commit;
          }
        },
        error: () => {
          this.fetchingCommit = false;
        }
      });
  }

  private handleRepoInfoError(err: any) {
    this.commitsSub?.unsubscribe();
    this.fetchingCommits = false;
    this.fetchingCommit = false;
    this.commitsLoadingForBranch = null;

    if (!this.repoStructure) {
      this.commits = [];
      this.latestCommit = null;
      this.commitsLoadedForBranch = '';
    }

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

  // ── BRANCH & COMMIT SELECTION ──
  onBranchSelect(newBranch: string) {
    this.commitsSub?.unsubscribe();
    this.fetchingCommits = false;
    this.commitsLoadingForBranch = null;

    this.branchName = newBranch;
    this.actionError = '';
    this.selectedCommitSha = '';
    this.pinnedCommitInfo = null;
    this.commitLookupError = '';
    this.commits = [];
    this.commitsPage = 1;
    this.commitsHasMore = false;
    this.commitsLoadedForBranch = '';
    this.resetPollingState();

    // Ensure a manually entered branch remains visible in the local list
    if (newBranch && !this.branches.includes(newBranch)) {
      this.branches = [newBranch, ...this.branches];
    }

    if (this.repoStructure !== null || this.loading) {
      this.analyzeSub?.unsubscribe();
      this.loading = false;
      this.runAnalyze(Boolean(this.repoInfo));
    } else {
      this.loadBranchCommits(1, false);
    }
  }

  onCommitSelect(event: CommitSelectionEvent) {
    this.actionError = '';
    this.commitLookupError = '';
    this.selectedCommitSha = event.sha;
    this.pinnedCommitInfo = event.sha ? event.commit : null;

    if (this.repoStructure !== null) {
      const targetScope = this.selectedCommitSha ? `commit:${this.selectedCommitSha}` : 'latest';
      const parsed = this.parseUrlInput(this.repoUrl);
      const nextKey = parsed
        ? `${parsed.owner.toLowerCase()}/${parsed.repo.toLowerCase()}#${this.branchName}@${targetScope}`
        : '';

      if (nextKey !== this.lastAnalyzedKey || this.newCommitAvailable) {
        this.runAnalyze();
      }
    }
  }

  onCommitDropdownOpenChange(open: boolean) {
    this.commitDropdownOpen = open;
    if (!open) return;

    const currentBranch = this.branchName;
    if (!currentBranch || !this.isUrlValid) return;

    const needsInitialLoad =
      this.commitsLoadedForBranch !== currentBranch || (this.commits.length === 0 && !this.emptyRepo);

    const isStaleHead =
      this.commits.length > 0 &&
      this.latestCommit &&
      !this.latestCommit.empty &&
      this.commits[0].sha !== this.latestCommit.sha;

    const alreadyLoadingCurrent =
      this.fetchingCommits &&
      (this.commitsLoadingForBranch === currentBranch || this.commitsLoadingForBranch === '');

    if ((needsInitialLoad || isStaleHead) && !alreadyLoadingCurrent) {
      this.loadBranchCommits(1, false);
    }
  }

  loadBranchCommits(page = 1, append = false, branchOverride?: string) {
    const targetBranch = branchOverride !== undefined ? branchOverride : this.branchName;
    if (!this.repoUrl || (branchOverride === undefined && !targetBranch)) return;

    if (append) {
      this.loadingMoreCommits = true;
    } else {
      this.commitsSub?.unsubscribe();
      this.fetchingCommits = true;
      this.commitsLoadingForBranch = targetBranch;
      if (!this.latestCommit) {
        this.fetchingCommit = true;
      }
    }

    this.commitsSub = this.api
      .getCommits(this.repoUrl, targetBranch, page, 30, this.githubToken || undefined)
      .subscribe({
        next: res => {
          this.fetchingCommits = false;
          this.loadingMoreCommits = false;
          this.fetchingCommit = false;
          this.commitsLoadingForBranch = null;
          this.commitsLoadedForBranch = targetBranch || this.branchName;
          this.commitsPage = res.page;
          this.commitsHasMore = Boolean(res.has_more);

          if (append) {
            const seen = new Set(this.commits.map(c => c.sha));
            const extra = res.commits.filter(c => !seen.has(c.sha));
            this.commits = [...this.commits, ...extra];
          } else {
            this.commits = res.commits;
            if (res.commits.length > 0) {
              const incomingHead = res.commits[0];
              const existingEtag =
                this.latestCommit &&
                !this.latestCommit.empty &&
                this.latestCommit.sha === incomingHead.sha &&
                this.latestCommit.etag
                  ? this.latestCommit.etag
                  : '';

              this.latestCommit = existingEtag
                ? { ...incomingHead, etag: existingEtag }
                : incomingHead;

              if (!this.baselineHeadSha) {
                this.baselineHeadSha = incomingHead.sha;
              }
            } else if (res.empty) {
              this.latestCommit = {
                empty: true,
                sha: '',
                tree_sha: '',
                message: 'Repository is empty (no commits yet)',
                author: '',
                date: '',
                html_url: ''
              };
            }
          }
        },
        error: err => {
          this.fetchingCommits = false;
          this.loadingMoreCommits = false;
          this.fetchingCommit = false;
          this.commitsLoadingForBranch = null;
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

  loadMoreCommits() {
    if (this.loadingMoreCommits || !this.commitsHasMore) return;
    this.loadBranchCommits(this.commitsPage + 1, true);
  }

  lookupCommitBySha(sha: string) {
    if (!this.repoUrl || !sha || this.lookingUpCommit) return;

    this.lookingUpCommit = true;
    this.commitLookupError = '';

    this.api
      .getCommits(this.repoUrl, this.branchName, 1, 1, this.githubToken || undefined, sha)
      .subscribe({
        next: res => {
          this.lookingUpCommit = false;
          const found = res.commits?.[0];
          if (!found) {
            this.commitLookupError = `No commit found matching "${sha}".`;
            return;
          }

          this.commitLookupError = '';
          this.commitSelector?.close();
          this.onCommitSelect({ sha: found.sha, commit: found });
        },
        error: err => {
          this.lookingUpCommit = false;
          this.commitLookupError = err?.error?.error || 'Could not look up that commit.';
        }
      });
  }

  switchToLatestFromBar() {
    this.selectedCommitSha = '';
    this.pinnedCommitInfo = null;
    this.runAnalyze();
  }

  private resetCommitSelectionState() {
    this.commits = [];
    this.commitsPage = 1;
    this.commitsHasMore = false;
    this.fetchingCommits = false;
    this.loadingMoreCommits = false;
    this.lookingUpCommit = false;
    this.commitLookupError = '';
    this.selectedCommitSha = '';
    this.pinnedCommitInfo = null;
    this.commitsLoadedForBranch = '';
    this.commitsLoadingForBranch = null;
  }

  // ── ANALYZE (Loads or refreshes tree, preserves custom selections, and auto-generates bundle) ──
  onAnalyze() {
    this.activeRecentUrl = '';
    this.pendingBranchFallback = false;
    this.pendingFallbackFromBranch = '';
    this.runAnalyze();
  }

  private runAnalyze(skipInfoFetch = false) {
    const parsed = this.parseUrlInput(this.repoUrl);
    if (!parsed || this.loading) return;

    if (this.urlDebounce) clearTimeout(this.urlDebounce);

    // If branches haven't finished loading yet (e.g. instant click after paste), load info first
    if (!this.branchName) {
      this.fetchRepoInfo(true);
      return;
    }

    const commitScope = this.selectedCommitSha ? `commit:${this.selectedCommitSha}` : 'latest';
    const targetKey = `${parsed.owner.toLowerCase()}/${parsed.repo.toLowerCase()}#${this.branchName}@${commitScope}`;
    const isSameTarget = this.repoStructure !== null && this.lastAnalyzedKey === targetKey;

    let prevSelectedPaths: Set<string> | null = null;
    let wasAllSelected = true;

    if (isSameTarget && this.repoStructure) {
      wasAllSelected = this.totalFileCount > 0 && this.selectedFileCount === this.totalFileCount;
      if (!wasAllSelected) {
        prevSelectedPaths = new Set(this.collectFiles(this.repoStructure));
      }
    }

    this.stopCommitPolling();
    this.repoInfoSub?.unsubscribe();
    this.commitSub?.unsubscribe();
    this.analyzeSub?.unsubscribe();
    this.processSub?.unsubscribe();

    this.loading = true;
    this.generatingText = false;
    this.fetchingCommit = true;
    this.actionError = '';
    this.repoError = '';
    this.repoErrorMessage = '';
    this.justRefreshed = false;
    this.pollingPaused = false;

    if (!this.selectedCommitSha) {
      this.newCommitAvailable = null;
      this.dismissedNewCommitSha = '';
    }

    if (!isSameTarget) {
      this.clearOutput();
      this.repoStructure = null;
      this._filteredStructure = null;
      this.mobileTab = 'files';
    }

    this.showFullPreview = false;

    const token = this.githubToken || undefined;
    const requestedBranch = this.branchName;
    const requestedCommitSha = this.selectedCommitSha || undefined;

    let latestInfo: RepoInfo | null = skipInfoFetch ? this.repoInfo : null;
    let latestAnalysis: AnalyzeResponse | null = null;
    let infoErrored = false;
    let fallbackWaitingForInfo = false;
    let fallbackErr: any = null;

    // Run repoInfo, analyzeRepo, and commits in parallel without holding branches/commits behind the tree fetch
    if (!skipInfoFetch || !this.repoInfo) {
      this.fetchingBranches = true;
      this.repoInfoSub = this.api.getRepoInfo(this.repoUrl, token).subscribe({
        next: info => {
          this.fetchingBranches = false;
          latestInfo = info;
          this.repoInfo = info;

          if (fallbackWaitingForInfo) {
            fallbackWaitingForInfo = false;
            const failedBranch = this.pendingFallbackFromBranch;
            this.pendingBranchFallback = false;
            this.pendingFallbackFromBranch = '';
            this.branches = info.branches;

            if (failedBranch && !info.branches.includes(failedBranch) && info.default_branch) {
              this.branchName = info.default_branch;
              this.loading = false;
              this.runAnalyze(true);
            } else {
              this.activeRecentUrl = '';
              this.loading = false;
              this.fetchingCommit = false;
              this.handleAnalyzeError(fallbackErr);
            }
            return;
          }

          if (info.branches.includes(requestedBranch)) {
            this.branches = info.branches;
            this.branchName = requestedBranch;
          } else if (requestedBranch) {
            this.branches = [requestedBranch, ...info.branches];
            this.branchName = requestedBranch;
          } else {
            this.branches = info.branches;
            this.branchName = info.default_branch;
          }

          if (latestAnalysis) {
            this.recordRecentRepo(info, latestAnalysis);
          }
        },
        error: infoErr => {
          this.fetchingBranches = false;
          infoErrored = true;

          if (fallbackWaitingForInfo) {
            fallbackWaitingForInfo = false;
            this.loading = false;
            this.fetchingCommit = false;
            this.activeRecentUrl = '';
            this.pendingBranchFallback = false;
            this.pendingFallbackFromBranch = '';
            this.handleRepoInfoError(infoErr);
            return;
          }

          if (!latestAnalysis) {
            this.analyzeSub?.unsubscribe();
            this.commitsSub?.unsubscribe();
            this.fetchingCommits = false;
            this.commitsLoadingForBranch = null;
            this.loading = false;
            this.fetchingCommit = false;
            this.activeRecentUrl = '';
            this.pendingBranchFallback = false;
            this.pendingFallbackFromBranch = '';
            this.handleRepoInfoError(infoErr);
          }
        }
      });
    }

    const alreadyLoadingTargetCommits =
      this.fetchingCommits &&
      (this.commitsLoadingForBranch === requestedBranch || this.commitsLoadingForBranch === '');

    if (requestedBranch && this.commitsLoadedForBranch !== requestedBranch && !alreadyLoadingTargetCommits) {
      this.loadBranchCommits(1, false, requestedBranch);
    }

    this.analyzeSub = this.api
      .analyzeRepo(this.repoUrl, requestedBranch, token, requestedCommitSha)
      .subscribe({
        next: analysis => {
          latestAnalysis = analysis;
          this.activeRecentUrl = '';
          this.pendingBranchFallback = false;
          this.pendingFallbackFromBranch = '';

          this.applyAnalysisResult(
            analysis,
            targetKey,
            isSameTarget,
            wasAllSelected,
            prevSelectedPaths,
            Boolean(requestedCommitSha)
          );

          if (latestInfo) {
            this.recordRecentRepo(latestInfo, analysis);
          }
        },
        error: err => {
          const code = err?.error?.code || '';

          // If a cached recent repo branch was deleted on GitHub, retry once on the repo's default branch
          if (
            this.pendingBranchFallback &&
            this.pendingFallbackFromBranch &&
            (code === 'NOT_FOUND' || code === 'LACKS_CONTENTS_PERMISSION')
          ) {
            const failedBranch = this.pendingFallbackFromBranch;

            if (latestInfo) {
              this.pendingBranchFallback = false;
              this.pendingFallbackFromBranch = '';
              this.branches = latestInfo.branches;

              if (!latestInfo.branches.includes(failedBranch) && latestInfo.default_branch) {
                this.branchName = latestInfo.default_branch;
                this.loading = false;
                this.runAnalyze(true);
                return;
              }
            } else if (!infoErrored && this.repoInfoSub) {
              this.commitsSub?.unsubscribe();
              this.fetchingCommits = false;
              this.commitsLoadingForBranch = null;
              fallbackWaitingForInfo = true;
              fallbackErr = err;
              return;
            }
          }

          this.repoInfoSub?.unsubscribe();
          this.commitsSub?.unsubscribe();
          this.fetchingBranches = false;
          this.fetchingCommits = false;
          this.commitsLoadingForBranch = null;
          this.activeRecentUrl = '';
          this.pendingBranchFallback = false;
          this.pendingFallbackFromBranch = '';
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
    isPinnedCommit: boolean
  ) {
    this.repoStructure = res.structure;
    this.repoPath = res.repo_path;
    this.repoName = res.repo_name;
    this.owner = res.owner;
    this.branch = res.branch || this.branchName;
    this.analyzedCommitSha = res.commit_sha || '';
    this.analyzedMode = isPinnedCommit ? 'commit' : 'latest';
    this.analyzedCommitInfo = res.latest_commit;
    this.treeTruncated = Boolean(res.truncated);
    this.emptyRepo = Boolean(res.empty);
    this.lastAnalyzedKey = targetKey;

    if (isPinnedCommit) {
      if (res.commit_sha) {
        this.selectedCommitSha = res.commit_sha;
      }
      if (res.latest_commit) {
        this.pinnedCommitInfo = res.latest_commit;
      }
    } else if (res.latest_commit) {
      this.latestCommit = res.latest_commit;
      this.latestCommitEtag = res.latest_commit.etag || '';
      this.baselineHeadSha = res.latest_commit.sha || '';
      this.newCommitAvailable = null;
      this.dismissedNewCommitSha = '';
      this.lastCommitPollAt = Date.now();

      // Keep loaded commit list fresh when a newer HEAD arrives
      if (
        this.commitsLoadedForBranch === this.branch &&
        this.commits.length > 0 &&
        !res.latest_commit.empty &&
        res.latest_commit.sha &&
        !this.commits.some(c => c.sha === res.latest_commit?.sha)
      ) {
        this.commits = [res.latest_commit, ...this.commits];
      }
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

    if (!this.emptyRepo) {
      this.startCommitPolling();
    }

    if (this.selectedFileCount > 0) {
      this.generateText();
    } else {
      this.clearOutput();
    }
  }

  private recordRecentRepo(info: RepoInfo, analysis: AnalyzeResponse) {
    const owner = info.owner || analysis.owner;
    const repoName = info.repo_name || analysis.repo_name;
    const fullName = info.full_name || `${owner}/${repoName}`;
    const branch = analysis.branch || this.branchName || info.default_branch;

    this.recentRepos = this.recentReposService.save({
      url: `https://github.com/${fullName}`,
      owner,
      repoName,
      fullName,
      branch,
      description: info.description || '',
      language: info.language || '',
      stars: info.stars || 0,
      private: Boolean(info.private),
      totalFiles: analysis.total_files ?? this.totalFileCount
    });
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

  // ── LIVE COMMIT POLLING ON ANALYZED SCREEN ──
  private startCommitPolling() {
    this.stopCommitPolling();
    this.commitPollInterval = setInterval(() => {
      if (this.document.visibilityState !== 'visible') return;
      if (!this.repoStructure || this.loading || this.emptyRepo || this.pollingPaused) return;
      if (this.checkingForNewCommits) return;
      this.checkForNewCommits(false);
    }, COMMIT_POLL_INTERVAL_MS);
  }

  private stopCommitPolling() {
    if (this.commitPollInterval) {
      clearInterval(this.commitPollInterval);
      this.commitPollInterval = null;
    }
    this.pollSub?.unsubscribe();
    this.checkingForNewCommits = false;
  }

  private resetPollingState() {
    this.baselineHeadSha = '';
    this.latestCommitEtag = '';
    this.newCommitAvailable = null;
    this.dismissedNewCommitSha = '';
    this.commitCheckUpToDate = false;
    this.pollingPaused = false;
    this.lastCommitPollAt = 0;
  }

  private triggerFocusCommitCheck() {
    if (!this.repoStructure || this.loading || this.emptyRepo || this.pollingPaused) return;
    if (this.checkingForNewCommits) return;
    if (Date.now() - this.lastCommitPollAt < FOCUS_CHECK_COOLDOWN_MS) return;
    this.checkForNewCommits(false);
  }

  checkForNewCommits(manual = false) {
    if (!this.repoStructure || this.loading || this.emptyRepo) return;
    const targetBranch = this.branch || this.branchName;
    if (!this.repoUrl || !targetBranch || this.checkingForNewCommits) return;

    if (manual) {
      this.pollingPaused = false;
      this.commitCheckUpToDate = false;
      if (this.upToDateTimer) {
        clearTimeout(this.upToDateTimer);
        this.upToDateTimer = null;
      }
    }

    this.pollSub?.unsubscribe();
    this.checkingForNewCommits = true;
    this.lastCommitPollAt = Date.now();

    const etagToSend = this.latestCommitEtag || undefined;

    this.pollSub = this.api
      .getLatestCommit(this.repoUrl, targetBranch, this.githubToken || undefined, undefined, etagToSend)
      .subscribe({
        next: res => {
          this.checkingForNewCommits = false;

          if (res.unchanged) {
            if (manual) {
              this.triggerUpToDateNotice();
            }
            return;
          }

          if (res.etag !== undefined) {
            this.latestCommitEtag = res.etag;
          }

          if (!res.sha || res.empty) {
            if (manual) {
              this.triggerUpToDateNotice();
            }
            return;
          }

          this.latestCommit = res;

          // If the user opened directly to a historical commit without a branch HEAD baseline yet,
          // record current HEAD quietly so only subsequent pushes trigger an alert
          if (!this.baselineHeadSha) {
            this.baselineHeadSha = res.sha;
            if (manual) {
              this.triggerUpToDateNotice();
            }
            return;
          }

          const isNewerThanBaseline = res.sha !== this.baselineHeadSha;
          const isDifferentFromAnalyzed = res.sha !== this.analyzedCommitSha;

          if (isNewerThanBaseline && isDifferentFromAnalyzed) {
            if (manual || res.sha !== this.dismissedNewCommitSha) {
              this.newCommitAvailable = res;
            }
          } else {
            this.newCommitAvailable = null;
            if (manual) {
              this.triggerUpToDateNotice();
            }
          }
        },
        error: err => {
          this.checkingForNewCommits = false;
          const code = err?.error?.code || '';
          if (code === 'RATE_LIMITED') {
            this.pollingPaused = true;
            if (manual) {
              this.repoError = 'rate_limited';
              this.repoErrorMessage = err?.error?.error || '';
            }
          } else if (manual) {
            this.actionError = err?.error?.error || 'Could not check for new commits.';
          }
        }
      });
  }

  applyNewCommit() {
    if (!this.newCommitAvailable || this.loading) return;
    const targetBranch = this.branch || this.branchName;
    if (targetBranch) {
      this.branchName = targetBranch;
    }
    this.selectedCommitSha = '';
    this.pinnedCommitInfo = null;
    this.newCommitAvailable = null;
    this.dismissedNewCommitSha = '';
    this.runAnalyze();
  }

  dismissNewCommit() {
    if (this.newCommitAvailable?.sha) {
      this.dismissedNewCommitSha = this.newCommitAvailable.sha;
    }
    this.newCommitAvailable = null;
  }

  private triggerUpToDateNotice() {
    if (this.upToDateTimer) clearTimeout(this.upToDateTimer);
    this.commitCheckUpToDate = true;
    this.upToDateTimer = setTimeout(() => {
      this.commitCheckUpToDate = false;
    }, 2200);
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
  generateText() {
    if (!this.repoStructure) return;

    const files = this.collectFiles(this.repoStructure);
    if (!files.length) {
      this.actionError = 'Select at least one file to generate a bundle.';
      return;
    }

    this.processSub?.unsubscribe();
    this.clearOutput();
    this.generatingText = true;
    this.actionError = '';
    this.mobileTab = 'output';

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
          this.mobileTab = 'output';
        },
        error: err => {
          this.generatingText = false;
          this.mobileTab = 'files';
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

  private clearOutput() {
    if (this.copyTimer) {
      clearTimeout(this.copyTimer);
      this.copyTimer = null;
    }
    this.finalText = '';
    this.charCount = 0;
    this.tokenCount = 0;
    this.fileCount = 0;
    this.skippedFiles = [];
    this.copyBtnText = 'Copy';
    this.copied = false;
    this.showFullPreview = false;
    this.isLoadingFullPreview = false;
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
    const commitSuffix = this.analyzedMode === 'commit' && this.analyzedCommitSha
      ? `-${this.analyzedCommitSha.slice(0, 7)}`
      : '';
    a.download = `${this.repoName || 'copygit'}-${safeBranch}${commitSuffix}.txt`;
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