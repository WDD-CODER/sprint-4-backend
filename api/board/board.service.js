import * as Sentry from "@sentry/node"
import { ObjectId } from 'mongodb'

import { logger } from '../../services/logger.service.js'
import { makeId } from '../../services/util.service.js'
import { dbService } from '../../services/db.service.js'
import { asyncLocalStorage } from '../../services/als.service.js'
import { DateTime } from "luxon"

const PAGE_SIZE = 3

export const boardService = {
    remove,
    query,
    getById,
    add,
    update,
    addBoardMsg,
    removeBoardMsg,
    // group
    addGroup,
    removeGroup,
    updateGroup,
    updateGroupOrder,
    // task details
    getTaskById,
    // task
    addTask,
    duplicateTask,
    updateTask,
    updateTaskOrder,
    addUpdate,
    removeTask,
    // dashboard
    getDashboardData
}

async function query(filterBy = { txt: '' }) {
    try {
        // const criteria = _buildCriteria(filterBy)
        // const sort = _buildSort(filterBy)

        const collection = await dbService.getCollection('board')
        const miniBoards = await collection.find({}, { projection: { _id: 1, title: 1, isStarred: 1 } })
        const boards = await miniBoards.toArray()
        return boards
    } catch (err) {
        logger.error('cannot find boards', err)
        throw err
    }
}




async function getById(boardId, filterBy = {}) {
  try {
    // Parent span for the whole function
    return await Sentry.startSpan(
      { op: "logic", name: "getById" },
      async () => {

        // 1) DB span
        const board = await Sentry.startSpan(
          { op: "db", name: "db.find board by id" },
          async () => {
            const criteria = { _id: ObjectId.createFromHexString(boardId) };
            const collection = await dbService.getCollection("board");
            return await collection.findOne(criteria);
          }
        );

        // 2) createdAt
        Sentry.startSpan(
          { op: "logic", name: "compute createdAt" },
          () => { board.createdAt = board._id.getTimestamp(); }
        );

        // 3) filterOptions
        const filterOptions = await Sentry.startSpan(
          { op: "logic", name: "_getFilterOptions" },
          () => _getFilterOptions(board)
        );

        // 4) filteredBoard
        const filteredBoard = await Sentry.startSpan(
          { op: "logic", name: "_getFilteredBoard" },
          () => _getFilteredBoard(board, filterBy)
        );

        return { board: filteredBoard, filterOptions };
      }
    );

  } catch (err) {
    logger.error(`while finding board ${boardId}`, err);
    throw err;
  }
}

async function remove(boardId) {
    const { loggedinUser } = asyncLocalStorage.getStore()
    const { _id: ownerId, isAdmin } = loggedinUser

    try {
        const criteria = {
            _id: ObjectId.createFromHexString(boardId),
        }
        if (!isAdmin) criteria['owner._id'] = ownerId

        const collection = await dbService.getCollection('board')
        const res = await collection.deleteOne(criteria)

        if (res.deletedCount === 0) throw ('Not your board')
        return boardId
    } catch (err) {
        logger.error(`cannot remove board ${boardId}`, err)
        throw err
    }
}

async function add(board) {

    try {
        const collection = await dbService.getCollection('board')
        await collection.insertOne(board)

        return board
    } catch (err) {
        logger.error('cannot insert board', err)
        throw err
    }
}

async function update(board) {
    const { _id, ...boardToSave } = board

    try {
        const criteria = { _id: ObjectId.createFromHexString(board._id) }
        const collection = await dbService.getCollection('board')
        delete boardToSave._id
        await collection.updateOne(criteria, { $set: boardToSave })
        return board
    } catch (err) {
        logger.error(`cannot update board ${board._id}`, err)
        throw err
    }
}

async function addBoardMsg(boardId, msg) {
    try {
        const criteria = { _id: ObjectId.createFromHexString(boardId) }
        msg.id = makeId()

        const collection = await dbService.getCollection('board')
        await collection.updateOne(criteria, { $push: { msgs: msg } })

        return msg
    } catch (err) {
        logger.error(`cannot add board msg ${boardId}`, err)
        throw err
    }
}

async function removeBoardMsg(boardId, msgId) {
    try {
        const criteria = { _id: ObjectId.createFromHexString(boardId) }

        const collection = await dbService.getCollection('board')
        await collection.updateOne(criteria, { $pull: { msgs: { id: msgId } } })

        return msgId
    } catch (err) {
        logger.error(`cannot remove board msg ${boardId}`, err)
        throw err
    }
}

/// groups functions

export async function addGroup(boardId, newGroup) {
    try {
        const collection = await dbService.getCollection('board')

        const criteria = { _id: ObjectId.createFromHexString(boardId) }

        const add = { $push: { groups: newGroup } }

        await collection.updateOne(criteria, add)

        return newGroup

    } catch (err) {
        console.error('Failed to add group to board', err)
        throw err
    }
}

export async function updateGroup(boardId, updatedGroup) {
    try {
        const collection = await dbService.getCollection('board')

        const criteria = {
            _id: ObjectId.createFromHexString(boardId),
            'groups.id': updatedGroup.id
        };


        const update = {
            $set: {
                'groups.$': updatedGroup
            }
        };

        await collection.updateOne(criteria, update)

        return updatedGroup
    } catch (err) {
        console.error('Failed to add group to board', err)
        throw err
    }
}

export async function updateGroupOrder(boardId, orderedGroups) {
    try {
        const collection = await dbService.getCollection('board')

        const criteria = { _id: ObjectId.createFromHexString(boardId) }

        const update = {
            $set: {
                groups: orderedGroups
            }
        }

        await collection.updateOne(criteria, update)

        return orderedGroups
    } catch (err) {
        console.error('Failed to update group order in board', err)
        throw err
    }
}

async function removeGroup(boardId, groupId) {
    try {
        const criteria = { _id: ObjectId.createFromHexString(boardId) }

        const collection = await dbService.getCollection('board')
        const updatedBoard = await collection.findOneAndUpdate(
            criteria,
            { $pull: { groups: { id: groupId } } },
            { returnDocument: 'before' }
        )

        const deletedGroup = updatedBoard.groups.find(group => group.id === groupId)
        const miniDeletedGroup = { id: deletedGroup.id, title: deletedGroup.title }

        return miniDeletedGroup
    } catch (err) {
        logger.error(`cannot remove group ${groupId} from board ${boardId}`, err)
        throw err
    }
}

// task details

async function getTaskById(boardId, taskId) {
    try {
        const collection = await dbService.getCollection('board')

        const pipeline = [
            { $match: { _id: ObjectId.createFromHexString(boardId) } },
            { $unwind: '$groups' },
            { $unwind: '$groups.tasks' },
            { $match: { 'groups.tasks.id': taskId } },
            {
                $project: {
                    _id: 0,
                    id: '$groups.tasks.id',
                    title: '$groups.tasks.title',
                    file: '$groups.tasks.file',
                    groupId: '$groups.id',
                    createdAt: '$groups.tasks.createdAt',
                    updates: '$groups.tasks.updates',

                    activities: {
                        $filter: {
                            input: '$activities',
                            as: 'activity',
                            cond: { $eq: ['$$activity.task.id', taskId] }
                        }
                    }
                }
            },
            { $sort: { 'activities.createdAt': -1 } }
        ]

        const result = await collection.aggregate(pipeline).toArray()

        if (!result.length) throw new Error(`Task ${taskId} not found`)

        return result[0]

    } catch (err) {
        console.error('cannot get task', err)
        throw err
    }
}

/// task 

async function addTask(boardId, groupId, task, method = 'push') {
    console.log('METHOD:', method);


    try {
        const collection = await dbService.getCollection('board')

        const criteria = { _id: ObjectId.createFromHexString(boardId), 'groups.id': groupId }

        let add
        if (method === 'unshift') {
            add = {
                $push: {
                    'groups.$.tasks': {
                        $each: [task],
                        $position: 0
                    }
                }
            }
        } else {
            add = { $push: { 'groups.$.tasks': task } }
        }

        await collection.updateOne(criteria, add)

        return task
    } catch (err) {
        console.error('cannot add task', err)
        throw err
    }
}

async function duplicateTask(boardId, groupId, taskCopy) {


    try {
        const collection = await dbService.getCollection('board')
        const board = await collection.findOne({ _id: ObjectId.createFromHexString(boardId) })
        const group = board.groups.find(g => g.id === groupId)
        console.log(group.tasks);

        const taskCopyIdx = group.tasks.findIndex(t => t.id === taskCopy.id)

        taskCopy.id = makeId()
        taskCopy.createdAt = Date.now()

        const criteria = { _id: ObjectId.createFromHexString(boardId), 'groups.id': groupId }
        const addCopy = {
            $push: {
                'groups.$.tasks': {
                    $each: [taskCopy],
                    $position: +taskCopyIdx + 1
                }
            }
        }

        const result = await collection.updateOne(criteria, addCopy)

        if (!result.matchedCount) throw new Error(`Board ${boardId} or group ${groupId} not found`)

        return { duplicatedTask: taskCopy, taskCopyIdx: taskCopyIdx + 1 }

    } catch (err) {
        throw err
    }
}

async function updateTask(boardId, groupId, taskId, taskToUpdate, activityTitle, loggedinUser) {
    try {
        const collection = await dbService.getCollection('board')

        const criteria = { _id: ObjectId.createFromHexString(boardId) }
        const update = {
            $set: Object.fromEntries(
                Object.entries(taskToUpdate).map(([key, value]) => [
                    `groups.$[g].tasks.$[t].${key}`,
                    value
                ])
            )
        }

        const options = {
            arrayFilters: [
                { 'g.id': groupId },
                { 't.id': taskId }
            ],
            returnDocument: 'after'
        }


        const result = await collection.findOneAndUpdate(criteria, update, options)
        const updatedBoard = result.value || result

        if (!updatedBoard) throw new Error('Board not found for task update.')


        const group = updatedBoard.groups.find(g => g.id === groupId)
        if (!group) throw new Error('group not found after update')

        const taskIdx = group.tasks.findIndex(task => task.id = taskId)
        const activity = _createActivity(activityTitle, _getMiniUser(loggedinUser),
            _toMiniGroup(group), _toMiniTask(group.tasks[taskIdx]))

        await saveActivity(boardId, activity)

        const savedTask = taskToUpdate
        return { savedTask, activity }

    } catch (err) {
        console.error('cannot update task', err)
        throw err
    }
}


async function saveActivity(boardId, activity) {
    try {
        const collection = await dbService.getCollection('board')

        const result = await collection.updateOne(
            { _id: ObjectId.createFromHexString(boardId) },
            { $push: { activities: activity } }
        )

        if (result.modifiedCount === 0)
            throw new Error(`Failed to add activity to board ${boardId}`)

        return activity
    } catch (err) {
        console.error(' Cannot save activity:', err)
        throw err
    }
}

async function addUpdate(boardId, groupId, taskId, updateTitle, loggedinUser) {

    try {

        const collection = await dbService.getCollection('board')
        const criteria = { _id: ObjectId.createFromHexString(boardId) }

        const updateToAdd = _createUpdate(updateTitle, _getMiniUser(loggedinUser))

        const update = {
            $push: {
                'groups.$[g].tasks.$[t].updates': {
                    $each: [updateToAdd],
                    $position: 0
                }
            }
        }

        const options = {
            arrayFilters: [
                { 'g.id': groupId },
                { 't.id': taskId }
            ],
            returnDocument: 'after'
        }

        const result = await collection.findOneAndUpdate(criteria, update, options)
        const updatedBoard = result.value || result

        if (!updatedBoard) throw new Error('Board not found for task update.')

        const group = updatedBoard.groups.find(g => g.id === groupId)
        if (!group) throw new Error(`Group ${groupId} not found`)

        const task = group.tasks.find(t => t.id === taskId)
        if (task === -1) throw new Error(`Task ${taskId} not found`)

        if (!task) {
            throw new Error('Task not found on addUpdated to task ');
        }


        return task
    } catch (error) {
        console.error('cannot add update to task', error)
        throw error
    }
}

export async function updateTaskOrder(boardId, groupId, orderedTasks) {
    try {
        const collection = await dbService.getCollection('board')

        const result = await collection.findOneAndUpdate(
            { _id: ObjectId.createFromHexString(boardId), 'groups.id': groupId },
            { $set: { 'groups.$.tasks': orderedTasks } },
            { returnDocument: 'after' }
        )

        const updatedBoard = result;

        if (!updatedBoard) {
            throw new Error('Board or group not found for update.')
        }
        return { success: true, board: updatedBoard }
    } catch (err) {
        console.error(' cannot update task order', err)
        throw err
    }
}



async function removeTask(boardId, groupId, taskId) {
    try {
        const criteria = {
            _id: ObjectId.createFromHexString(boardId),
            'groups.id': groupId
        }

        const collection = await dbService.getCollection('board')
        const updatedBoard = await collection.findOneAndUpdate(
            criteria,
            { $pull: { 'groups.$.tasks': { id: taskId } } },
            { returnDocument: 'before' }
        )

        if (!updatedBoard) {
            throw new Error(`Board with id ${boardId} or group with id ${groupId} not found`)
        }

        const group = updatedBoard.groups.find(group => group.id === groupId)
        const deletedTask = group.tasks.find(task => task.id === taskId)

        return deletedTask
    } catch (err) {
        console.error('cannot add task', err)
        throw err
    }
}

//// dashboard
export async function getDashboardData(filterBy = {}) {
    try {
        const collection = await dbService.getCollection('board')

        const pipeline = [
            { $unwind: '$groups' },
            { $unwind: '$groups.tasks' },

            {
                $project: {
                    status: '$groups.tasks.status',
                    priority: '$groups.tasks.priority',
                    memberIds: '$groups.tasks.memberIds'
                }
            },

            {
                $addFields: {
                    memberIds: {
                        $map: {
                            input: '$memberIds',
                            as: 'id',
                            in: {
                                $cond: {
                                    if: { $regexMatch: { input: '$$id', regex: /^[0-9a-fA-F]{24}$/ } },
                                    then: { $toObjectId: '$$id' },
                                    else: '$$id'
                                }
                            }
                        }
                    }
                }
            },

            {
                $facet: {
                    tasksCount: [{ $count: 'total' }],

                    byStatus: [
                        {
                            $group: {
                                _id: { $ifNull: ['$status.id', 'none'] },
                                txt: { $first: { $ifNull: ['$status.txt', 'No Status'] } },
                                cssVar: { $first: { $ifNull: ['$status.cssVar', '--layout-border-color'] } },
                                tasksCount: { $sum: 1 }
                            }
                        },
                        {
                            $addFields: {
                                order: {
                                    $switch: {
                                        branches: [
                                            { case: { $eq: ['$_id', 'done'] }, then: 1 },
                                            { case: { $eq: ['$_id', 'working'] }, then: 2 },
                                            { case: { $eq: ['$_id', 'stuck'] }, then: 3 },
                                            { case: { $eq: ['$_id', 'default'] }, then: 4 }, // "Not Started"
                                        ],
                                        default: 99 // new/unexpected statuses appear after these
                                    }
                                }
                            }
                        },
                        { $sort: { order: 1 } } // sort by our defined order
                    ],



                    // ✅ NEW byPriority facet (with fallback for missing values)
                    byPriority: [
                        {
                            $group: {
                                _id: { $ifNull: ['$priority.id', 'none'] },
                                txt: { $first: { $ifNull: ['$priority.txt', 'No Priority'] } },
                                cssVar: { $first: { $ifNull: ['$priority.cssVar', '--layout-border-color'] } },
                                tasksCount: { $sum: 1 }
                            }
                        },
                        // 👇 Add these two lines
                        {
                            $addFields: {
                                order: {
                                    $switch: {
                                        branches: [
                                            { case: { $eq: ['$_id', 'low'] }, then: 1 },
                                            { case: { $eq: ['$_id', 'medium'] }, then: 2 },
                                            { case: { $eq: ['$_id', 'high'] }, then: 3 },
                                            { case: { $eq: ['$_id', 'critical'] }, then: 4 },
                                        ],
                                        default: 99
                                    }
                                }
                            }
                        },
                        { $sort: { order: 1 } } // ✅ final sort by your custom order
                    ],


                    byMember: [
                        { $unwind: { path: '$memberIds', preserveNullAndEmptyArrays: false } },
                        {
                            $group: {
                                _id: '$memberIds',
                                tasksCount: { $sum: 1 }
                            }
                        }
                    ]
                }
            },

            { $unwind: { path: '$byMember', preserveNullAndEmptyArrays: true } },

            {
                $lookup: {
                    from: 'user',
                    localField: 'byMember._id',
                    foreignField: '_id',
                    as: 'byMember.userInfo'
                }
            },

            {
                $set: {
                    'byMember.userInfo': { $arrayElemAt: ['$byMember.userInfo', 0] }
                }
            },

            {
                $group: {
                    _id: null,
                    tasksCount: { $first: '$tasksCount' },
                    byStatus: { $first: '$byStatus' },
                    byPriority: { $first: '$byPriority' },
                    byMember: { $push: '$byMember' }
                }
            }
        ]

        const [result] = await collection.aggregate(pipeline).toArray()

        const tasksCount = result?.tasksCount?.[0]?.total || 0

        const byStatus = result.byStatus.map(s => ({
            id: s._id,
            txt: s.txt,
            cssVar: s.cssVar,
            tasksCount: s.tasksCount,
            tasksPercentage: parseFloat(((s.tasksCount / tasksCount) * 100).toFixed(1))
        }))

        const byPriority = result.byPriority.map(p => ({
            id: p._id,
            txt: p.txt,
            cssVar: p.cssVar,
            tasksCount: p.tasksCount,
            tasksPercentage: parseFloat(((p.tasksCount / tasksCount) * 100).toFixed(1))
        }))

        const byMember = result.byMember.map(m => ({
            memberId: m._id,
            fullname: m.userInfo?.fullname || 'Unknown',
            imgUrl: m.userInfo?.imgUrl || '',
            tasksCount: m.tasksCount,
            tasksPercentage: parseFloat(((m.tasksCount / tasksCount) * 100).toFixed(1))
        }))


        return { tasksCount, byStatus, byPriority, byMember }

    } catch (err) {
        console.error('Failed to build dashboard data:', err)
        throw err
    }
}

//////////////////////////////////////////////////////////////////
// General function 

function _buildCriteria(filterBy) {
    const criteria = {
        title: { $regex: filterBy.txt, $options: 'i' },
    }

    return criteria
}

function _buildSort(filterBy) {
    if (!filterBy.sortField) return {}
    return { [filterBy.sortField]: filterBy.sortDir }
}

function _createActivity(activityTitle, miniUser, miniGroup, miniTask) {
    return {
        id: makeId(),
        title: activityTitle,
        createdAt: Date.now(),
        byMember: miniUser,
        group: miniGroup,
        task: miniTask,
    }
}

function _getMiniUser(user) {
    // const user = getLoggedinUser()
    if (user) {
        return {
            _id: user?._id,
            fullname: user?.fullname,
            imgUrl: user?.imgUrl,
        }
    } else {
        return {
            _id: 'guest',
            fullname: 'guest',
            imgUrl: '/img/gray-avatar.svg',
        }
    }

}

function _toMiniTask({ id, title }) {

    return { id, title }
}

function _toMiniGroup({ id, title }) {
    return { id, title }
}

function _createUpdate(updateTitle, miniUser) {
    return {
        id: makeId(),
        title: updateTitle,
        createdAt: Date.now(),
        byMember: miniUser,
    }
}

function _getFilteredBoard(board, filterBy) {
    if (filterBy?.byGroups.length > 0) {
        board.groups = board.groups.filter(g => filterBy.byGroups.includes(g.id))
    }

    if (filterBy?.byNames?.length > 0) {
        board.groups = board.groups.filter(g => {
            g.tasks = g.tasks.filter(t => filterBy.byNames.includes(t.title))
            return g?.tasks?.length > 0
        })
    }


    if (filterBy?.byStatuses?.length > 0) {
        board.groups = board.groups.filter(g => {
            g.tasks = g.tasks.filter(t => filterBy.byStatuses.includes(t?.status?.id))
            return g?.tasks?.length > 0
        })
    }

    if (filterBy?.byPriorities?.length > 0) {
        board.groups = board.groups.filter(g => {
            g.tasks = g.tasks.filter(t => filterBy.byPriorities.includes(t?.priority?.id))
            return g?.tasks?.length > 0
        })
    }

    if (filterBy?.byMembers?.length > 0) {
        board.groups = board.groups.filter(g => {
            g.tasks = g.tasks.filter(t => {
                return filterBy.byMembers.some(m => t?.memberIds.includes(m))
            })
            return g?.tasks?.length > 0
        })
    }

    if (filterBy?.byDueDateOp?.length > 0) {
        const now = DateTime.local()
        const ops = filterBy.byDueDateOp

        board.groups = board.groups
            .filter(g => {
                g.tasks = g.tasks.filter(t => {
                    if (!t?.dueDate?.date) return false

                    const dueDate = DateTime.fromMillis(t.dueDate.date)
                    const isDone = t?.status?.id === "done"
                    const updatedAt = t?.status?.updatedAt
                        ? DateTime.fromMillis(t.status.updatedAt)
                        : null

                    return (
                        (ops.includes("today") && dueDate.hasSame(now, "day")) ||
                        (ops.includes("tomorrow") && dueDate.hasSame(now.plus({ days: 1 }), "day")) ||
                        (ops.includes("yesterday") && dueDate.hasSame(now.minus({ days: 1 }), "day")) ||

                        (ops.includes("this week") && dueDate.hasSame(now, "week")) ||
                        (ops.includes("last week") && dueDate.hasSame(now.minus({ weeks: 1 }), "week")) ||
                        (ops.includes("next week") && dueDate.hasSame(now.plus({ weeks: 1 }), "week")) ||

                        (ops.includes("this month") && dueDate.hasSame(now, "month")) ||
                        (ops.includes("last month") && dueDate.hasSame(now.minus({ months: 1 }), "month")) ||
                        (ops.includes("next month") && dueDate.hasSame(now.plus({ months: 1 }), "month")) ||

                        (ops.includes("overdue") && !isDone && dueDate.startOf("day") < now.startOf("day")) ||
                        (ops.includes("done on time") && isDone && updatedAt && updatedAt <= dueDate) ||
                        (ops.includes("done overdue") && isDone && updatedAt && updatedAt > dueDate)
                    )
                })
                return g?.tasks?.length > 0
            })
    }

    /// Filter by specific user as opposed to a list of users ids from person filter

    if (filterBy?.byPerson) {
        board.groups = board.groups.filter(g => {
            g.tasks = g.tasks.filter(t => t?.memberIds.includes(filterBy.byPerson))
            return g?.tasks?.length > 0
        })
    }

    if (filterBy?.sortBy && filterBy?.dir) {
        if (filterBy?.sortBy === 'name') {
            board.groups = board.groups.map(g => {
                g.tasks = g.tasks.sort((t1, t2) => (t1?.title.localeCompare(t2?.title)) * filterBy?.dir)
                return g
            })
        } else if (filterBy?.sortBy === 'date') {
            board.groups = board.groups.map(g => {
                g.tasks = g.tasks.sort((t1, t2) => (t1?.dueDate?.date - t2?.dueDate?.date) * filterBy?.dir)
                return g
            })
        } else if (filterBy?.sortBy === 'status') {
            board.groups = board.groups.map(g => {
                g.tasks = g.tasks.sort((t1, t2) => (t1?.status?.txt.localeCompare(t2?.status?.txt)) * filterBy?.dir)
                return g
            })
        } else if (filterBy?.sortBy === 'priority') {
            board.groups = board.groups.map(g => {
                g.tasks = g.tasks.sort((t1, t2) => (t1?.priority?.txt.localeCompare(t2?.priority?.txt)) * filterBy?.dir)
                return g
            })
        } else if (filterBy?.sortBy === 'members') {
            board.groups = board.groups.map(g => {

                g.tasks = g.tasks.sort((t1, t2) => {

                    const member1 = board.members.find(m => m._id === t1.memberIds[0])?.fullname || ''
                    const member2 = board.members.find(m => m._id === t2.memberIds[0])?.fullname || ''

                    return (member1.localeCompare(member2)) * filterBy?.dir
                })
                return g
            })
        }
    }
    return board
}


function _getFilterOptions(board) {
    const filterOptions = {}

    filterOptions.groups = board.groups.map(g => {
        return { id: g.id, title: g.title, color: g.style['--group-color'], taskSum: g?.tasks?.length }
    })


    const nameCounts = board.groups.reduce((acc, g) => {
        g.tasks.forEach(t => {
            if (acc[t.title]) acc[t.title] += 1
            else acc[t.title] = 1
        })

        return acc
    }, {})

    filterOptions.names = Object.entries(nameCounts).map(([name, count]) => {
        return { name, count }
    })

    return filterOptions
}