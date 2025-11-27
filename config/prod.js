export default {
    dbURL: process.env.MONGO_URL ||
        `mongodb+srv://danweibren_db_user:0g4S33V8lIRvyEo4@oneday.0rvqfsg.mongodb.net/OneDay
    ?retryWrites=true
    &w=majority
    &authSource=admin
    &maxPoolSize=20
    &minPoolSize=5
    &keepAlive=true
    &appName=OneDay
`.trim(),
    dbName: process.env.DB_NAME || 'oneDay_db'
}
