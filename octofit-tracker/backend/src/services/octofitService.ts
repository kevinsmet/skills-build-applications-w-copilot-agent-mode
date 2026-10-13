import mongoose from 'mongoose';
import { Activity, Team, User, Workout } from '../models/index.js';

function badRequest(message: string) {
  return Object.assign(new Error(message), { status: 400 });
}

function notFound(message: string) {
  return Object.assign(new Error(message), { status: 404 });
}

function normalizeId(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const candidate = String(value).trim();
  return candidate.length > 0 ? candidate : undefined;
}

export async function listActivities() {
  return Activity.find().lean();
}

export async function createActivity(input: unknown) {
  const payload = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const userId = normalizeId(payload.userId);
  const teamId = normalizeId(payload.teamId);
  const type = typeof payload.type === 'string' ? payload.type.trim() : '';
  const minutesValue = Number(payload.minutes);

  if (!userId || !teamId || !type || !Number.isFinite(minutesValue) || minutesValue <= 0) {
    throw badRequest('Activity requires userId, teamId, type, and minutes.');
  }

  if (!mongoose.isValidObjectId(userId) || !mongoose.isValidObjectId(teamId)) {
    throw badRequest('userId and teamId must be valid MongoDB ObjectIds.');
  }

  const user = await User.findById(userId);
  if (!user) {
    throw notFound('User not found.');
  }

  const team = await Team.findById(teamId);
  if (!team) {
    throw notFound('Team not found.');
  }

  const minutes = Math.round(minutesValue);
  const activity = await Activity.create({
    user: user._id,
    team: team._id,
    type,
    minutes,
    points: minutes,
    occurredAt: new Date(),
  });

  return activity.toObject();
}

export async function listTeams() {
  return Team.find().lean();
}

export async function createTeam(input: unknown) {
  const payload = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  const mascot = typeof payload.mascot === 'string' ? payload.mascot.trim() : '';
  const members = Array.isArray(payload.members) ? payload.members : [];

  if (!name || !mascot) {
    throw badRequest('Team requires a name and mascot.');
  }

  const validMemberIds = members
    .map((member) => normalizeId(member))
    .filter((member): member is string => Boolean(member));

  for (const memberId of validMemberIds) {
    if (!mongoose.isValidObjectId(memberId)) {
      throw badRequest('Team members must contain valid MongoDB ObjectIds.');
    }
  }

  const team = await Team.create({
    name,
    mascot,
    members: validMemberIds.map((memberId) => new mongoose.Types.ObjectId(memberId)),
  });

  return team.toObject();
}

export async function getLeaderboard() {
  const rows = await Activity.aggregate([
    { $group: { _id: '$team', totalPoints: { $sum: '$points' } } },
    { $lookup: { from: 'teams', localField: '_id', foreignField: '_id', as: 'team' } },
    { $unwind: '$team' },
    { $project: { _id: 0, teamName: '$team.name', totalPoints: 1 } },
    { $sort: { totalPoints: -1, teamName: 1 } },
  ]);

  return rows.map((row, index) => ({ teamName: row.teamName, totalPoints: row.totalPoints, rank: index + 1 }));
}

export async function suggestWorkouts(userEmail: string) {
  const email = String(userEmail ?? '').trim();
  const user = await User.findOne({ email: { $regex: `^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } }).lean();

  if (!user) {
    throw notFound('User not found.');
  }

  const recentActivity = await Activity.findOne({ user: user._id }).sort({ occurredAt: -1 }).lean();
  const focusCandidates = [user.fitnessGoal, recentActivity?.type].filter((value): value is string => Boolean(value));

  const workout = await Workout.find({ focus: { $in: focusCandidates } }).sort({ focus: -1 }).lean();
  if (workout.length === 0) {
    const fallback = await Workout.findOne().lean();
    if (!fallback) return [];
    return [{
      ...fallback,
      reason: `This workout matches your recent activity and fitness goals.`,
    }];
  }

  const preferred = workout.find((item) => item.focus === user.fitnessGoal) ?? workout[0];
  const reason = user.fitnessGoal && preferred.focus === user.fitnessGoal
    ? `Your ${user.fitnessGoal} goal and recent activity suggest this workout.`
    : `Your recent ${recentActivity?.type ?? 'activity'} suggests this workout.`;

  return [{
    ...preferred,
    reason,
  }];
}

export { User };
