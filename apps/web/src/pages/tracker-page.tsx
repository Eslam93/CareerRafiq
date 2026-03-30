import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { TrackerStatus } from '@career-rafiq/contracts';
import { webApiClient } from '../api-client.js';
import { useTrackerListQuery } from '../api-hooks.js';
import { PageSection } from '../components/page-section.js';
import { QueryState } from '../components/query-state.js';
import { jobReviewPath, trackerDetailPath } from '../route-paths.js';
import { toErrorMessage } from '../utils/text.js';

function SummaryPill(props: { label: string; value: string; tone: 'good' | 'warning' | 'neutral' }) {
  return (
    <div className={`pill pill--${props.tone}`}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function formatNextActionLabel(
  nextAction:
    | {
        code: string;
        label: string;
        rationale: string;
      }
    | null
    | undefined,
) {
  if (!nextAction) return 'n/a';
  return `${nextAction.label} (${nextAction.code})`;
}

function formatLabel(value: string | null | undefined) {
  if (!value) return 'n/a';
  return value.replaceAll('_', ' ');
}

export function TrackerPage() {
  const trackerListQuery = useTrackerListQuery();
  const trackedRef = useRef(false);
  const [statusFilter, setStatusFilter] = useState<'all' | TrackerStatus>('all');
  const [sortBy, setSortBy] = useState<'updated' | 'title' | 'company' | 'score'>('updated');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!trackerListQuery.data || trackedRef.current) {
      return;
    }
    trackedRef.current = true;
    void webApiClient.trackAnalyticsEvent('tracker_opened');
  }, [trackerListQuery.data]);

  const filteredItems = useMemo(() => {
    const items = trackerListQuery.data?.items ?? [];
    const loweredSearch = search.trim().toLowerCase();
    const filtered = items.filter((entry) => {
      if (statusFilter !== 'all' && entry.trackerItem.currentStatus !== statusFilter) {
        return false;
      }
      if (!loweredSearch) {
        return true;
      }
      const haystack = [
        entry.job.normalizedJobObject.title,
        entry.job.normalizedJobObject.company,
        entry.job.normalizedJobObject.location,
        entry.evaluation?.recommendedCvId,
        entry.recommendedCvName,
        entry.selectedCvName,
        entry.evaluation?.verdict,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(loweredSearch);
    });

    return [...filtered].sort((left, right) => {
      if (sortBy === 'title') {
        return (left.job.normalizedJobObject.title ?? '').localeCompare(right.job.normalizedJobObject.title ?? '');
      }
      if (sortBy === 'company') {
        return (left.job.normalizedJobObject.company ?? '').localeCompare(right.job.normalizedJobObject.company ?? '');
      }
      if (sortBy === 'score') {
        return (right.evaluation?.totalScore ?? -1) - (left.evaluation?.totalScore ?? -1);
      }
      return right.trackerItem.updatedAt.localeCompare(left.trackerItem.updatedAt);
    });
  }, [search, sortBy, statusFilter, trackerListQuery.data?.items]);

  const summary = useMemo(() => {
    const items = trackerListQuery.data?.items ?? [];
    return {
      total: items.length,
      reviewRequired: items.filter((entry) => entry.job.jobExtractionState === 'review_required').length,
      duplicates: items.filter((entry) => entry.trackerItem.probableDuplicateJobIds.length > 0).length,
      applyReady: items.filter((entry) => entry.evaluation?.verdict === 'apply').length,
    };
  }, [trackerListQuery.data?.items]);

  return (
    <div className="page-stack">
      <PageSection title="Tracker" subtitle="Persistent source of truth for each opportunity, including trust decisions and duplicate surfacing.">
        <QueryState
          isLoading={trackerListQuery.isLoading}
          errorMessage={trackerListQuery.error ? toErrorMessage(trackerListQuery.error) : null}
          loadingLabel="Loading tracker items..."
        />
        {trackerListQuery.data ? (
          <div className="stack">
            <div className={summary.reviewRequired > 0 ? 'callout callout--warning' : 'callout callout--success'}>
              <strong>Tracker state:</strong>{' '}
              {summary.reviewRequired > 0
                ? `${summary.reviewRequired} item(s) still need job review before the verdict is fully trustworthy.`
                : 'No jobs are currently blocked in the review gate.'}
            </div>
            <div className="pill-grid">
              <SummaryPill label="Total Jobs" value={String(summary.total)} tone={summary.total > 0 ? 'good' : 'neutral'} />
              <SummaryPill label="Review Queue" value={String(summary.reviewRequired)} tone={summary.reviewRequired > 0 ? 'warning' : 'good'} />
              <SummaryPill label="Duplicates" value={String(summary.duplicates)} tone={summary.duplicates > 0 ? 'warning' : 'neutral'} />
              <SummaryPill label="Apply Verdicts" value={String(summary.applyReady)} tone={summary.applyReady > 0 ? 'good' : 'neutral'} />
            </div>
          </div>
        ) : null}
      </PageSection>

      <PageSection title="Filter and Sort" subtitle="Search by title, company, location, recommended CV, or verdict.">
        <div className="toolbar">
          <label className="field">
            <span>Search</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Platform Engineer, Acme, apply, Backend CV" />
          </label>
          <label className="field">
            <span>Status filter</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
              <option value="all">All statuses</option>
              <option value="saved">Saved</option>
              <option value="considering">Considering</option>
              <option value="applied">Applied</option>
              <option value="interviewing">Interviewing</option>
              <option value="rejected">Rejected</option>
              <option value="offer">Offer</option>
              <option value="archived_not_pursuing">Archived</option>
            </select>
          </label>
          <label className="field">
            <span>Sort by</span>
            <select value={sortBy} onChange={(event) => setSortBy(event.target.value as typeof sortBy)}>
              <option value="updated">Recently updated</option>
              <option value="score">Highest score</option>
              <option value="title">Title</option>
              <option value="company">Company</option>
            </select>
          </label>
        </div>
      </PageSection>

      <PageSection title="Tracked Opportunities" subtitle="The tracker keeps recommendation trust, verdict trust, and workflow status separate.">
        {trackerListQuery.data && filteredItems.length === 0 ? <p>No tracked jobs match the current filter.</p> : null}
        {trackerListQuery.data && filteredItems.length > 0 ? (
          <div className="panel-grid">
            {filteredItems.map((entry) => {
              const reviewRequired = entry.job.jobExtractionState === 'review_required';
              const selectedCv = entry.selectedCvName
                ?? entry.recommendedCvName
                ?? entry.trackerItem.userSelectedCvId
                ?? entry.evaluation?.recommendedCvId
                ?? entry.trackerItem.recommendationSnapshot?.recommendedCvId
                ?? 'n/a';
              return (
                <article key={entry.trackerItem.id} className="card card--compact">
                  <div className="stack">
                    <div>
                      <strong>{entry.job.normalizedJobObject.title ?? 'Untitled role'}</strong>
                      <div className="muted">{entry.job.normalizedJobObject.company ?? 'Unknown company'}</div>
                      <div className="muted">
                        {entry.job.normalizedJobObject.location ?? 'Unknown location'} | {formatLabel(entry.job.normalizedJobObject.workSetup)}
                      </div>
                    </div>
                    <div className="pill-grid">
                      <SummaryPill label="Status" value={formatLabel(entry.trackerItem.currentStatus)} tone="neutral" />
                      <SummaryPill label="Verdict" value={entry.evaluation?.verdict ?? entry.trackerItem.recommendationSnapshot?.verdict ?? 'n/a'} tone={entry.evaluation?.verdict === 'apply' ? 'good' : reviewRequired ? 'warning' : 'neutral'} />
                      <SummaryPill label="CV" value={selectedCv} tone="neutral" />
                      <SummaryPill label="Extraction" value={formatLabel(entry.job.jobExtractionState)} tone={reviewRequired ? 'warning' : 'good'} />
                    </div>
                    <p className="muted">
                      Updated {new Date(entry.trackerItem.updatedAt).toLocaleString()} | next action {formatNextActionLabel(entry.trackerItem.nextActionSnapshot ?? entry.evaluation?.nextAction)}
                    </p>
                    <p className="muted">
                      Recommendation trust: {formatLabel(entry.trackerItem.recommendedCvDecision)} | verdict trust: {formatLabel(entry.trackerItem.verdictDecision)}
                    </p>
                    {(entry.recommendedCvName || entry.selectedCvName) ? (
                      <p className="muted">
                        System CV: {entry.recommendedCvName ?? 'n/a'} | effective CV: {entry.selectedCvName ?? entry.recommendedCvName ?? 'n/a'}
                      </p>
                    ) : null}
                    {entry.trackerItem.probableDuplicateJobIds.length > 0 ? (
                      <div className="callout callout--warning">
                        <strong>Duplicate risk:</strong> {entry.trackerItem.probableDuplicateJobIds.length} possible duplicate(s) remain visible for manual review.
                      </div>
                    ) : null}
                    <div className="button-row">
                      <Link to={trackerDetailPath(entry.job.id)}>Open detail</Link>
                      <Link to={jobReviewPath(entry.job.id)}>{reviewRequired ? 'Finish review' : 'Open review'}</Link>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}
      </PageSection>
    </div>
  );
}
