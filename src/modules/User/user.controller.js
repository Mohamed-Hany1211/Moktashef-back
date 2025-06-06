// modules imports
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import otpGenerator from 'otp-generator';
// files imports
import User from '../../../DB/models/user.model.js';
import sendEmailService from '../../services/Send-mail.service.js';
import generateUniqueString from '../../utils/generate-unique-string.js';
import cloudinaryConnection from '../../utils/cloudinary.js';
// ======================== signUp api 
/*
    1 - destructing the required data from the body
    2 - check if the user is already exist in DB
    3 - creating user's token for email confirmation
    4 - sending confirmation email to the user
    5 - hashing the password
    6 - creating new user object
    7 - saving the user in DB
    8 - rollback the saved document in case of any error after user creation
    9 - return the response
*/
export const signUp = async (req, res, next) => {
    // 1 - destructing the required data from the body
    const {
        userName,
        email,
        password,
    } = req.body;
    // 2 - check if the user is already exist in DB
    const isUserExist = await User.findOne({
        $or: [
            { email },
            { userName }
        ]
    })
    if (isUserExist) return next(new Error('User already exist', { cause: 409 }));
    // 3 - creating user's token for email confirmation
    const userToken = jwt.sign({ email }, process.env.JWT_SECRET_VEREFICATION, { expiresIn: '5m' });
    // 4 - sending confirmation email to the user
    const isEmailSent = await sendEmailService({
        to: email,
        subject: 'Email Verification',
        message: `<section style="width: 100%; height: 100vh; display: flex; justify-content: center; align-items: center;">
        <div style="width: 50%; background-color: rgba(128, 128, 128,0.3); height: 20vh; border-radius: .625rem; text-align: center;">
            <h2 style=" color: black; text-shadow: 7px 7px 5px  white;display:block;font-size:25px;">Please click the link to verify your account</h2>
            <a style="text-decoration: none; font-size: 20px; " href='http://localhost:3000/user/verify-email?token=${userToken}'>Verify Account</a>
        </div>
    </section>`
    });
    if (!isEmailSent) return next(new Error('Failed to send verification email', { cause: 500 }));
    // 5 - hashing the password
    const hashedPassword = bcrypt.hashSync(password, +process.env.SALT_ROUNDS);
    // 6 - creating new user object
    const userData = {
        userName,
        email,
        password: hashedPassword,
    };
    // 7 - saving the user in DB
    const newUser = await User.create(userData);
    // 8 - rollback the saved document in case of any error after user creation
    req.savedDocument = { model: User, _id: newUser._id };
    if (!newUser) return next({ message: 'User Creation Faild', cause: 500 });
    // 9 - return the response
    return res.status(201).json({
        success: true,
        message: 'User created successfully , please check your email to verify your account',
        data: newUser
    });
}

// ============================= verify the email ========================== //

/*
    1 - destructing the required data 
    2 - verify user's token 
    3 - get user by email with isEmailVerified = false
    4 - check if the user exist or not
    5 - return the response
*/
export const verifyEmail = async (req, res, next) => {
    // 1 - destructing the required data 
    const { token } = req.query;
    // 2 - verify user's token 
    const decodedData = jwt.verify(token, process.env.JWT_SECRET_VEREFICATION);
    // 3 - get user by email with isEmailVerified = false
    const findUser = await User.findOneAndUpdate({ email: decodedData.email, isEmailVerified: false }, { isEmailVerified: true }, { new: true });
    // 4 - check if the user exist or not
    if (!findUser) {
        return next(new Error(`user not foud`, { cause: 404 }));
    }
    // 5 - return the response
    return res.status(200).json({
        success: true,
        message: 'email verified successfully'
    });
}


// ============================== signIn api =============================== //
/*
    1 - get user data from request body
    2 - check if user is exist in database using the email
    3 - compare password with hashed password
    4 - create token
    5 - create flag for loggedIn User
    6 - return the response
*/
export const signIn = async (req, res, next) => {
    // 1 - get user data from request body
    const { email, password } = req.body;
    // 2 - check if user is exist in database using the email
    const userFound = await User.findOne({ email, isEmailVerified: true, isAccountDeleted: false });
    if (!userFound) {
        return next(new Error(`Invalid login credentials or your account is not verified yet, please signUp or check your mail`, { cause: 404 }));
    }
    // 3 - compare password with hashed password
    const verifyPass = bcrypt.compareSync(password, userFound.password);
    if (!verifyPass) {
        return next(new Error(`Incorrect password`, { cause: 401 }));
    }
    // 4 - create token
    const userToken = jwt.sign({ email, id: userFound._id, loggedIn: true }, process.env.JWT_SECRET_LOGIN, { expiresIn: '1d' });
    // 5 - create flag for loggedIn User
    userFound.isloggedIn = true;
    await userFound.save();
    // 6 - return the response
    return res.status(200).json({
        success: true,
        message: 'User loggedIn successfully',
        token: userToken
    })
}

// ============================ get user's profile api ========================= //
/*
    1 - get user id from the token
    2 - get user data from DB
    3 - check if user exist
    4 - return the user profile
*/
export const getProfile = async (req, res, next) => {
    // 1 - get user id from the token
    const { _id } = req.authUser;
    // 2 - get user data from DB
    const userProfile = await User.findById(_id);
    // 3 - check if user exist
    if (!userProfile) {
        return next(new Error(`User not found`, { cause: 404 }));
    }
    // 4 - return the user profile
    return res.status(200).json({
        success: true,
        message: 'User profile fetched successfully',
        data: userProfile
    })
}


// =========================== Delete Account api ============================== //
/*
    1 - destructing the user id of the loggedIn user(account owner)
    2 - find the user & delete user's document from DB
    3 - check if the user's document is deleted or not
    4 - delete user's media folder from cloudinary
    5 - return the response
*/
export const deleteAccount = async (req, res, next) => {
    // 1 - destructing the user id of the loggedIn user(account owner)
    const { _id } = req.authUser;
    // 2 - find the user & delete user's document from DB
    const deletedUser = await User.findById(_id);
    deletedUser.isAccountDeleted = true;
    // - save user document

    // 4 - delete user's media folder from cloudinary
    const { mediaFolderId } = deletedUser;
    if (mediaFolderId != null) {
        await cloudinaryConnection().api.delete_resources_by_prefix(`${process.env.MAIN_MEDIA_FOLDER}/USERS/${mediaFolderId}/user_picture`);
        await cloudinaryConnection().api.delete_folder(`${process.env.MAIN_MEDIA_FOLDER}/USERS/${mediaFolderId}`);
    }
    deletedUser.mediaFolderId = null;
    deletedUser.userImg = null;
    await deletedUser.save();
    // 5 - return the response
    return res.status(200).json({
        success: true,
        message: 'account deleted successfully'
    });
}

// ============================ update user profile api ========================= //
/*
    1 - destructing the user's data from the body
    2 - destructing the user id of the loggedIn user(account owner)
    3 - get the user's account
    4 - check if the user's account exist
    5 - check on the data given
    5.1 - update the user name after any change
        5.1.1 - update the user name
        5.1.2 - return the error message
    5.2 - check if the user wants to change his email also check if the new email is diffrent from the old one
        5.2.1 - change the old email with the new one
        5.2.2 - change the verfication flag because it is a new email 
        5.2.3 - creating user's token for email confirmation
        5.2.4 - sending confirmation email to the user
        5.2.5 - check if the verfication email sent or not
        5.2.6 - if the new email is the same of the old one we return error message
    6 - save the updated user account
    7 - return the response with updated user profile
*/
export const updateUserProfile = async (req, res, next) => {
    // 1 - destructing the user's data from the body
    const {
        userName,
        email,
    } = req.body;
    // 2 - destructing the user id of the loggedIn user(account owner)
    const { _id } = req.authUser;
    // 3 - get the user's account
    const userAccount = await User.findById(_id);
    // 4 - check if the user's account exist
    if (!userAccount) return next({ message: 'Account not found', cause: 404 });
    // 5 - check on the data given
    // 5.1 - update the user name after any change
    if (userName && userName !== userAccount.userName) {
        // 5.1.1 - update the user name
        userAccount.userName = userName;
    } else if (userName && userName == userAccount.userName) {
        // 5.1.2 - return the error message
        return next({ message: 'user name is already exist , enter diffrent user name', cause: 409 });
    }
    // 5.2 - check if the user wants to change his email also check if the new email is diffrent from the old one
    if (email && email !== userAccount.email) {
        // 5.2.1 - change the old email with the new one
        userAccount.email = email;
        // 5.2.2 - change the verfication flag because it is a new email 
        userAccount.isEmailVerified = false;
        // 5.2.3 - creating user's token for email confirmation
        const userToken = jwt.sign({ email }, process.env.JWT_SECRET_VEREFICATION, { expiresIn: '5m' });
        // 5.2.4 - sending confirmation email to the user
        const isEmailSent = await sendEmailService({
            to: email,
            subject: 'Email Verification',
            message: `<section style="width: 100%; height: 100vh; display: flex; justify-content: center; align-items: center;">
        <div style="width: 50%; background-color: rgba(128, 128, 128,0.3); height: 20vh; border-radius: .625rem; text-align: center;">
            <h2 style=" color: black; text-shadow: 7px 7px 5px  white;display:block;font-size:25px;">Please click the link to verify your account</h2>
            <a style="text-decoration: none; font-size: 20px; " href='http://localhost:3000/user/verify-email?token=${userToken}'>Verify Account</a>
        </div>
    </section>`
        });
        // 5.2.5 - check if the verfication email sent or not
        if (!isEmailSent) return next(new Error('Failed to send verification email', { cause: 500 }));
    } else if (email && email == userAccount.email) {
        // 5.2.6 - if the new email is the same of the old one we return error message
        return next({ message: 'Email is already exist , enter diffrent email', cause: 409 });
    }
    // 6 - save the updated user account
    await userAccount.save();
    // 7 - return the response with updated user profile
    return res.status(200).json({
        success: true,
        message: 'User profile updated successfully',
        data: userAccount
    });
}

// =============================== update password api ====================================== //
/*
    1 - destructing the user's data from the body
    2 - destructing the user id of the loggedIn user(account owner)
    3 - get the user's account
    4 - check if the user's account exist
    5 - check if the old password is correct
    6 - hash the new password
    7 - update the password
    8 - save the updated user account
    9 - return the response with updated password
*/
export const updatePassword = async (req, res, next) => {
    // 1 - destructing the user's data from the body
    const { oldPassword, newPassword } = req.body;
    // 2 - destructing the user id of the loggedIn user(account owner)
    const { _id } = req.authUser;
    // 3 - get the user's account
    const userAccount = await User.findById(_id);
    // 4 - check if the user's account exist
    if (!userAccount) return next({ message: 'Account not found', cause: 404 });
    // 5 - check if the old password is correct
    const isPasswordCorrect = bcrypt.compareSync(oldPassword, userAccount.password);
    if (!isPasswordCorrect) return next({ message: 'Incorrect old password', cause: 401 });
    // 6 - hash the new password
    const hashNewPassword = bcrypt.hashSync(newPassword, +process.env.SALT_ROUNDS);
    // 7 - update the password
    userAccount.password = hashNewPassword;
    // 8 - save the updated user account
    await userAccount.save();
    // 9 - return the response with updated password
    return res.status(200).json({
        success: true,
        message: 'Password updated successfully'
    });
}

// =============================== forget password api ====================================== //
/*
    1 - destructing the user's email
    2 - check if the email is exist
    3 - generate a random otp
    4 - send email to user containing the otp
    5 - save the otp in the user's document
    6 - return the response
*/
export const forgetPassword = async (req, res, next) => {
    // 1 - destructing the user's email
    const { email } = req.body;
    // 2 - check if the email is exist
    const isUserExist = await User.findOne({ email });
    if (!isUserExist) {
        return next(new Error('No account found associated with this email', { cause: 404 }));
    }
    // 3 - generate a random otp
    const OTP = otpGenerator.generate(6, { upperCaseAlphabets: false, specialChars: false });
    // 4 - send email to user containing the otp
    const isEmailSent = await sendEmailService({
        to: email,
        subject: 'Changing Password',
        message: `<section style="width: 100%; height: 100vh; display: flex; justify-content: center; align-items: center;">
            <div style="width: 50%; background-color: rgba(128, 128, 128,0.3); height: 20vh; border-radius: .625rem; text-align: center;">
                <h2 style=" color: black; text-shadow: 7px 7px 5px  white;display:block;font-size:25px;">Please Use The Following OTP To Reset Your Password</h2>
                <h4 style=" color: blue; text-shadow: 7px 7px 5px  white;display:block;font-size:25px;">${OTP}</h4>
            </div>
        </section>`
    });
    if (!isEmailSent) {
        return next(new Error('Failed to send email', { cause: 500 }));
    }
    // 5 - save the otp in the user's document
    isUserExist.ResetPasswordOTP = bcrypt.hashSync(OTP, +process.env.SALT_ROUNDS);
    await isUserExist.save();
    // 6 - return the response
    return res.status(200).json({
        success: true,
        message: 'OTP sent successfully, please check your email'
    });
}

// =================================== Reset password ======================================= //
/*
    1 - destructing the required data 
    2 - finding the user
    3 - check if otp is valid
    4 - update the password
    5 - delete the otp from the user document
    6 - return response
*/
export const resetPassword = async (req, res, next) => {
    // 1 - destructing the required data 
    const { email, OTP, newPassword } = req.body;
    // 2 - finding the user
    const requirdUser = await User.findOne({ email });
    if (!requirdUser) {
        return next(new Error('No account found associated with this email', { cause: 404 }));
    }
    // 3 - check if otp is valid
    const validateOTP = bcrypt.compareSync(OTP, requirdUser.ResetPasswordOTP);
    if (!validateOTP) {
        return next(new Error('OTP is Incorrect', { cause: 401 }));
    }
    // 4 - update the password
    requirdUser.password = bcrypt.hashSync(newPassword, +process.env.SALT_ROUNDS);
    // 5 - delete the otp from the user document
    requirdUser.ResetPasswordOTP = null;
    await requirdUser.save();
    // 6 - return response
    return res.status(200).json({
        success: true,
        message: 'The password was successfully reset.'
    });
}


// ====================================== upload profile image api =============================== //
/*
    1 - destructing the id of the signed in user 
    2 - finding the user
    3 - creating user media folder id
    4 - create the user image object
    5 - check if the user uploaded an imgae
        5.1 - upload user image on cloudinary
        5.2 - add the folder in request object so that if any error occure while uploading the image it will not upload due to rollback 
    6 - save the user
    7 - return response
*/
export const uploadImg = async (req, res, next) => {
    // 1 - destructing the id of the signed in user 
    const { _id } = req.authUser;
    // 2 - finding the user
    const user = await User.findOne({ _id, isAccountDeleted: false });
    if (!user) {
        return next({ message: 'No account found associated with this id', cause: 404 })
    }
    // 3 - creating user media folder id
    const UserfolderId = generateUniqueString(13);
    // 4 - create the user image object
    let userImg = {
        secure_url: '',
        public_id: ''
    }
    // 5 - check if the user uploaded an imgae
    if (!req.file) {
        userImg = {
            secure_url: '',
            public_id: ''
        }
    } else {
        // 5.1 - upload user image on cloudinary
        const { secure_url, public_id } = await cloudinaryConnection().uploader.upload(req.file.path, {
            folder: `${process.env.MAIN_MEDIA_FOLDER}/USERS/${UserfolderId}/user_picture`
        })
        // 5.2 - add the folder in request object so that if any error occure while uploading the image it will not upload due to rollback 
        req.folder = `${process.env.MAIN_MEDIA_FOLDER}/USERS/${UserfolderId}/user_picture`;
        userImg = {
            secure_url,
            public_id
        }
    }
    user.mediaFolderId = UserfolderId;
    user.userImg = userImg;
    //  6 - save the user
    await user.save();
    //  7 - return response
    return res.status(200).json({
        success: true,
        message: 'The user image is successfully uploaded.',
    })
}


// ====================================== update profile image api =============================== //

/* 
    1 - destructing the id of the signed in user 
    2 - destructing the old public id of the user image
    3 - finding the user
    4 - we delete the old img from cloudinary
    5 - we update the value of the old img
    6 - store the folder for rollback
    7 - update the image object
    8 - save the user
    9 - return response
*/

export const updateImg = async (req, res, next) => {
    // 1 - destructing the id of the signed in user 
    const { _id } = req.authUser;
    // 2 - destructing the old public id of the user image
    const { oldPublicId } = req.body;
    // 3 - finding the user
    const user = await User.findOne({ _id, isAccountDeleted: false });
    if (!user) {
        return next({ message: 'No account found associated with this id', cause: 404 })
    }
    // 4 - we delete the old img from cloudinary
    await cloudinaryConnection().uploader.destroy(oldPublicId);
    // 5 - we update the value of the old img
    const { secure_url, public_id } = await cloudinaryConnection().uploader.upload(req.file.path, {
        folder: `${process.env.MAIN_MEDIA_FOLDER}/USERS/${user.mediaFolderId}/user_picture`
    });
    // 6 - store the folder for rollback
    req.folder = `${process.env.MAIN_MEDIA_FOLDER}/USERS/${user.mediaFolderId}/user_picture`;
    // 7 - update the image object
    user.userImg = {
        secure_url,
        public_id
    }
    // 8 - save the user
    await user.save();
    //  9 - return response
    return res.status(200).json({
        success: true,
        message: 'The user image updated successfully',
    })
}

// ====================================== delete profile image api =============================== //

/* 
    1 - destructing the id of the signed in user 
    2 - finding the user
    3 - we delete the old img from cloudinary
    4 - we delete the user's image folder from cloudinary
    5 - update the user's mediaFolderId to null
    6 - update the user's image object to null
    7 - save the user
    8 - return response
*/

export const deleteImg = async (req, res, next) => {
    // 1 - destructing the id of the signed in user 
    const { _id } = req.authUser;
    // 2 - finding the user
    const user = await User.findOne({ _id, isAccountDeleted: false });
    if (!user) {
        return next({ message: 'No account found associated with this id', cause: 404 })
    }
    // 3 - we delete the old img from cloudinary
    await cloudinaryConnection().api.delete_resources_by_prefix(`${process.env.MAIN_MEDIA_FOLDER}/USERS/${user.mediaFolderId}/user_picture`);
    // 4 - we delete the user's image folder from cloudinary
    await cloudinaryConnection().api.delete_folder(`${process.env.MAIN_MEDIA_FOLDER}/USERS/${user.mediaFolderId}`);
    // 5 - update the user's mediaFolderId to null
    user.mediaFolderId = null;
    // 6 - update the user's image object to null
    user.userImg = null;
    // 7 - save the user
    await user.save();
    // 8 - return response
    return res.status(200).json({
        success: true,
        message: 'The user image deleted successfully',
    })
}