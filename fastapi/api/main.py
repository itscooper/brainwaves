"""
Brainwaves FastAPI Backend Server

This module implements the main FastAPI application that serves as the backend for the Brainwaves application.
It provides a RESTful API for managing profiles, groups, users, and configurations.

Key Components:
- Authentication: JWT-based authentication using fastapi-users
- User Management: Create, read, update users with role-based access control
- Profile Management: Create and manage student/pupil profiles with assessment data
- Group Management: Organize profiles into groups with customizable settings
- Configuration: Global application settings with secure access controls
- Practice Management: Access and manage practice recommendations

The application uses SQLAlchemy for database operations and implements both synchronous
and asynchronous database sessions as needed.
"""

# Standard library imports
import json
import os
import random
import string
import sys
import uuid
from pprint import pprint
from typing import Final, List, Optional

# Third-party imports
from fastapi import Body, Depends, FastAPI, HTTPException, Path, Query
from fastapi.responses import RedirectResponse
from fastapi.routing import APIRouter
from fastapi.staticfiles import StaticFiles
from fastapi_users import FastAPIUsers
from fastapi_users.db import SQLAlchemyUserDatabase
from fastapi_users.exceptions import UserAlreadyExists
from pydantic import BaseModel
from sqlalchemy import func, inspect, select, update
from sqlalchemy.ext.asyncio import async_sessionmaker
from sqlalchemy.orm import sessionmaker

# Local application imports
sys.path.append(os.path.abspath("/app/api"))
from auth import (
    SuperCreateUser,
    UserCreate,
    UserRead,
    UserUpdate,
    auth_backend,
    current_superuser_valid_pw,
    current_user,
    current_user_valid_pw,
    fastapi_users,
    get_user_manager_context,
    opt_current_user_valid_pw,
)
from bwjwt import createJwt, load_or_generate_key, verifyJwt
from emoji import is_single_emoji
from models import (
    Answer,
    Configuration,
    Group,
    Profile,
    ProfilerType,
    User,
    async_engine,
    sync_engine,
)

# Directory Constants
PRACTICE_DIR: Final[str] = "/app/api/practice"
"""Directory containing practice files and resources"""

PROFILERS_DIR: Final[str] = "/app/api/profilers"
"""Directory containing profiler configuration files"""

# Security Constants
SECRET_KEY: Final[bytes] = load_or_generate_key()
"""Secret key used for JWT token generation and verification"""

# Session Configuration Constants
ASYNC_SESSION_EXPIRE_ON_COMMIT: Final[bool] = False
"""Whether async database sessions should expire objects on commit"""

app = FastAPI(
    title="Brainwaves API",
    description="""
    Brainwaves FastAPI Backend Server that provides a RESTful API for managing profiles, groups, users, and configurations.
    
    Key Components:
    - Authentication: JWT-based authentication using fastapi-users
    - User Management: Create, read, update users with role-based access control
    - Profile Management: Create and manage student/pupil profiles with assessment data
    - Group Management: Organize profiles into groups with customizable settings
    - Configuration: Global application settings with secure access controls
    - Practice Management: Access and manage practice recommendations
    """,
    version="0.0.1"
)

# Mount static files using absolute path matching the Dockerfile
app.mount("/c", StaticFiles(directory="/app/client", html=True), name="static")

# Redirect root to index.html
@app.get("/")
async def serve_root():
    return RedirectResponse(url="/c/")

# Create sync and async session factories for the database
AsyncSessionLocal = async_session_maker = async_sessionmaker(bind=async_engine, expire_on_commit=ASYNC_SESSION_EXPIRE_ON_COMMIT) 
SyncSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=sync_engine)
SessionLocal = SyncSessionLocal

# API Router
api_router = APIRouter()

@api_router.get("/")
async def root():
    return {"message": "Welcome to the Brainwaves API!"}

@api_router.get("/profile/{profileID}", tags=["profiles"], 
    summary="Get Profile Details",
    description="""
    Retrieve details of a specific profile including answers and group information.
    Can be accessed by either a parent (with profile token) or a teacher (logged in user).
    Parents can only see incomplete profiles, while teachers can only see complete profiles.
    """,
    responses={
        200: {"description": "Profile details retrieved successfully"},
        401: {"description": "Unauthorized - Invalid token or missing authentication"},
        404: {"description": "Profile not found"}
    })
def get_profile(
    profileID: str = Path(..., description="The unique identifier of the profile"),
    profileToken: str = None,
    user=Depends(opt_current_user_valid_pw)
):
    # Authenticate using either a profile token or a logged-in user
    if profileToken:
        userType = 'parent'
        # Validate the parent JWT (profile token)
        try:
            jwt_payload = verifyJwt(profileToken)
        except Exception:
            raise HTTPException(status_code=401, detail="Invalid profile token")
        # Ensure the profileID matches the JWT subject
        if jwt_payload.get("sub") != profileID:
            raise HTTPException(status_code=401, detail="Token does not match profileID")
    elif user != None:
        # User is logged in via FastAPI-Users (teacher role)
        userType = 'teacher'
        pass  # No additional validation required for logged-in users
    else:
        # Neither a valid profile token nor a logged-in user
        raise HTTPException(status_code=401, detail="Unauthorised!")

    with SyncSessionLocal() as db:
        # Fetch the profile
        if userType == 'parent':
            # Parents can only see incomplete profiles
            profile = db.query(Profile).filter(Profile.id == profileID,Profile.status == "Incomplete").first()
        else:
            # Teachers can only see complete profiles
            profile = db.query(Profile).filter(Profile.id == profileID,Profile.status == "Complete").first()
        if not profile:
            raise HTTPException(status_code=404, detail="Profile not found")
        
        # Fetch the group's display name
        group = db.query(Group).filter(Group.name == profile.groupName).first()
        group_display_as = group.displayAs if group else "Unknown"

        # Fetch all associated answers
        answers = db.query(Answer).filter(Answer.profileId == profileID).all()

        # Return profile and answers
        return {
            "id": profile.id,
            "name": profile.name,
            "groupName": profile.groupName,
            "groupDisplayAs": group_display_as, 
            "profilerTypeName": profile.profilerTypeName,
            "status": profile.status,
            "answers": [
                {"id": answer.id, "question": answer.question, "score": answer.score, "domain": answer.domain}
                for answer in answers
            ]
        }

# Pydantic model for the create profile request body
class CreateProfileRequest(BaseModel):
    groupToken: str

@api_router.post("/profile", tags=["profiles"],
    summary="Create New Profile",
    description="""
    Create a new profile associated with a group using a group token.
    The profile is created with an empty name and 'Incomplete' status.
    """,
    responses={
        200: {"description": "Profile created successfully"},
        404: {"description": "Group not found"}
    })
def create_profile(request: CreateProfileRequest):
    groupToken = request.groupToken

    with SessionLocal() as db:
        # Step 1: Find the group matching the groupToken
        group = db.query(Group).filter(Group.token == groupToken).first()
        if not group:
            raise HTTPException(status_code=404, detail="Group with the provided token not found")

        # Step 2: Generate profile details
        profile_id = str(uuid.uuid4())
        profile_name = ""
        group_name = group.name
        profile_status = "Incomplete"
        profiler_type_name = group.profilerTypeName
        profileToken = createJwt(profile_id,None,1)

        # Step 3: Create the new profile
        new_profile = Profile(
            id=profile_id,
            name=profile_name,
            groupName=group_name,
            profilerTypeName=profiler_type_name,
            status=profile_status,
        )
        db.add(new_profile)
        db.commit()

        # Step 4: Return the created profile
        return {
            "id": profile_id,
            "name": profile_name,
            "groupName": group_name,
            "profilerTypeName": profiler_type_name,
            "groupDisplayAs": group.displayAs,
            "profileToken": profileToken,
            "status": profile_status
        }

class AnswerRequest(BaseModel):
    question: str
    score: int

@api_router.post("/profile/{profileID}/answer", tags=["profiles"],
    summary="Add or Update Answer",
    description="""
    Submit an answer for a specific question in a profile.
    If an answer for the question already exists, it will be updated.
    Only works for profiles with 'Incomplete' status.
    """,
    responses={
        200: {"description": "Answer created or updated successfully"},
        400: {"description": "Invalid request or profile not editable"},
        401: {"description": "Invalid profile token"}
    })
def add_answer(
    profileID: str = Path(..., description="The unique identifier of the profile"),
    answer_request: AnswerRequest = Body(..., description="The answer details"),
    profileToken: str = Query(..., description="JWT token for profile authentication")
):
    # Verify the JWT
    try:
        jwt_payload = verifyJwt(profileToken)
    except Exception as e:
        raise HTTPException(status_code=401, detail="Invalid profile token")

    # Ensure the profileID matches the JWT subject
    if jwt_payload.get("sub") != profileID:
        raise HTTPException(status_code=401, detail="Token does not match profile")

    with SessionLocal() as db:
        # Check that the profile can still be edited
        profile = db.query(Profile).filter(Profile.id == profileID,Profile.status == "Incomplete").first()
        if not profile:
            raise HTTPException(status_code=400, detail="Cannot find an editable profile with this ID")
        
        # Lookup the profilerType associated with the profile
        profiler_type = (
            db.query(ProfilerType).filter(ProfilerType.name == profile.profilerTypeName).first()
        )
        if not profiler_type:
            raise HTTPException(
                status_code=400,
                detail="ProfilerType not found for this profile",
            )

        # Read and parse the profiler JSON file
        try:
            with open(f"/app/api/profilers/{profiler_type.filename}", "r") as file:
                profiler_data = json.load(file)
        except FileNotFoundError:
            raise HTTPException(
                status_code=500,
                detail="Associated profiler file not found",
            )
        except json.JSONDecodeError:
            raise HTTPException(
                status_code=500,
                detail="Error decoding the profiler file",
            )

        # Verify the question exists and retrieve its domain
        question_data = next(
            (q for q in profiler_data["questions"] if q["question"] == answer_request.question), None
        )
        if not question_data:
            raise HTTPException(
                status_code=400,
                detail="Question not found in the associated profiler file",
            )
        domain = question_data["domain"]

        # Check if the question already exists for this profileID
        existing_answer = (
            db.query(Answer)
            .filter(Answer.profileId == profileID, Answer.question == answer_request.question)
            .first()
        )
        if existing_answer:
            # Overwrite the existing answer's score
            existing_answer.score = answer_request.score
            db.commit()

            # Return the updated answer
            return {
                "id": existing_answer.id,
                "profileId": existing_answer.profileId,
                "question": existing_answer.question,
                "score": existing_answer.score,
                "message": "Answer updated successfully",
            }
        else:
            # Create a new answer
            new_answer = Answer(
                id=str(uuid.uuid4()),
                profileId=profileID,
                question=answer_request.question,
                score=answer_request.score,
                domain=domain,
            )

            # Add and commit the new answer
            db.add(new_answer)
            db.commit()

            # Return the created answer
            return {
                "id": new_answer.id,
                "profileId": new_answer.profileId,
                "question": new_answer.question,
                "score": new_answer.score,
                "message": "Answer created successfully",
            }

class ProfileNameUpdateRequest(BaseModel):
    name: str

@api_router.put("/profile/{profileID}/name", tags=["profiles"],
    summary="Update Profile Name",
    description="""
    Update the name of a profile.
    Can be accessed by either a parent (incomplete profiles) or teacher (complete profiles).
    """,
    responses={
        200: {"description": "Profile name updated successfully"},
        400: {"description": "Profile not found or not accessible"},
        401: {"description": "Unauthorized"}
    })
def update_profile_name(
    profileID: str = Path(..., description="The unique identifier of the profile"),
    profileToken: str = None,
    name_update: ProfileNameUpdateRequest = Body(..., description="The new profile name"),
    user=Depends(opt_current_user_valid_pw)
):
    # Authenticate using either a profile token or a logged-in user
    if profileToken:
        userType = 'parent'
        # Validate the parent JWT (profile token)
        try:
            jwt_payload = verifyJwt(profileToken)
        except Exception:
            raise HTTPException(status_code=401, detail="Invalid profile token")
        # Ensure the profileID matches the JWT subject
        if jwt_payload.get("sub") != profileID:
            raise HTTPException(status_code=401, detail="Token does not match profileID")
    elif user != None:
        # User is logged in via FastAPI-Users (teacher role)
        userType = 'teacher'
        pass  # No additional validation required for logged-in users
    else:
        # Neither a valid profile token nor a logged-in user
        raise HTTPException(status_code=401, detail="Unauthorised!")

    with SessionLocal() as db:
        # Check that the profile can still be edited
        if userType == 'parent':
            profile = db.query(Profile).filter(Profile.id == profileID,Profile.status == "Incomplete").first()
            if not profile:
                raise HTTPException(status_code=400, detail="Cannot find an editable profile with this ID")
        else:
            profile = db.query(Profile).filter(Profile.id == profileID,Profile.status == "Complete").first()
            if not profile:
                raise HTTPException(status_code=400, detail="Cannot find a complete profile with this ID")

        # Update the profile's name
        profile.name = name_update.name
        db.commit()

        # Return the updated profile
        return {"id": profile.id, "name": profile.name}

@api_router.put("/profile/{profileID}/complete", tags=["profiles"],
    summary="Complete Profile",
    description="""
    Mark a profile as complete.
    This action can only be performed with a valid profile token and
    changes the profile status from 'Incomplete' to 'Complete'.
    """,
    responses={
        200: {"description": "Profile marked as complete"},
        401: {"description": "Invalid profile token"},
        404: {"description": "Profile not found"}
    })
def complete_profile(
    profileID: str = Path(..., description="The unique identifier of the profile"),
    profileToken: str = Query(..., description="JWT token for profile authentication")
):
    # Verify the JWT
    try:
        jwt_payload = verifyJwt(profileToken)
    except Exception as e:
        raise HTTPException(status_code=401, detail="Invalid profile token")

    # Ensure the profileID matches the JWT subject
    if jwt_payload.get("sub") != profileID:
        raise HTTPException(status_code=401, detail="Token does not match profileID")

    with SessionLocal() as db:
        # Fetch the profile
        profile = db.query(Profile).filter(Profile.id == profileID).first()
        if not profile:
            raise HTTPException(status_code=404, detail="Profile not found")

        # Update the profile's status to "complete"
        profile.status = "Complete"
        db.commit()

        # Return the updated profile
        return {
            "id": profile.id,
            "name": profile.name,
            "status": profile.status
        }

@api_router.delete("/profile/{profileID}", tags=["profiles"],
    summary="Delete Profile",
    description="Delete a profile and all its associated answers. Requires teacher authentication.",
    responses={
        204: {"description": "Profile deleted successfully"},
        401: {"description": "Unauthorized - Teacher authentication required"},
        404: {"description": "Profile not found"}
    })
async def delete_profile(
    profileID: str = Path(..., description="The unique identifier of the profile"),
    user=Depends(current_user_valid_pw)
):
    with SessionLocal() as db:
        profile = db.query(Profile).filter(Profile.id == profileID).first()
        if not profile:
            raise HTTPException(status_code=404, detail="Profile not found")
        db.delete(profile)
        db.commit()

@api_router.get("/profiler-type", tags=["profiler-types"],
    summary="List All Profiler Types",
    description="Retrieve a list of all available profiler type names. Requires teacher authentication.",
    responses={
        200: {"description": "List of profiler type names"},
        401: {"description": "Unauthorized - Teacher authentication required"}
    })
def get_all_profiler_types(user=Depends(current_user_valid_pw)):
    with SessionLocal() as db:
        profiler_types = db.query(ProfilerType.name).all()
        return [profiler_type.name for profiler_type in profiler_types]

@api_router.get("/profiler-type/{profilerTypeName}", tags=["profiler-types"],
    summary="Get Profiler Type Details",
    description="""
    Retrieve detailed information about a specific profiler type including:
    - Questions list (both simple and extended formats)
    - Answer options
    - Domains
    - Associated practice source
    Can be accessed by either a parent (with profile token) or teacher.
    """,
    responses={
        200: {"description": "Profiler type details retrieved successfully"},
        400: {"description": "Invalid filename in database"},
        401: {"description": "Unauthorized - Invalid token or missing authentication"},
        404: {"description": "Profiler type not found"},
        500: {"description": "Error reading or decoding profiler file"}
    })
def get_profiler_type(
    profilerTypeName: str = Path(..., description="The name of the profiler type"),
    profileToken: str = None,
    user=Depends(opt_current_user_valid_pw)
):
# Authenticate using either a profile token or a logged-in user
    if profileToken:
        userType = 'parent'
        # Validate the parent JWT (profile token)
        try:
            jwt_payload = verifyJwt(profileToken)
        except Exception:
            raise HTTPException(status_code=401, detail="Invalid profile token")

    elif user != None:
        # User is logged in via FastAPI-Users (teacher role)
        userType = 'teacher'
        pass  # No additional validation required for logged-in users
    else:
        # Neither a valid profile token nor a logged-in user
        raise HTTPException(status_code=401, detail="Unauthorised!")

    with SessionLocal() as db:
        # Fetch the ProfilerType
        profiler_type = db.query(ProfilerType).filter(ProfilerType.name == profilerTypeName).first()
        if not profiler_type:
            raise HTTPException(status_code=404, detail="ProfilerType not found")
        
        # Sanitize path to prevent directory traversal
        safe_path = os.path.abspath(os.path.join(PROFILERS_DIR, profiler_type.filename))
        if not safe_path.startswith(os.path.abspath(PROFILERS_DIR)):
            raise HTTPException(status_code=400, detail="Invalid filename in database")
        
        # Read the JSON file
        try:
            with open(safe_path, "r") as file:
                data = json.load(file)
        except FileNotFoundError:
            raise HTTPException(status_code=500, detail="Profiler file not found")
        except json.JSONDecodeError:
            raise HTTPException(status_code=500, detail="Error decoding profiler file")
        
        # Create questions list with both simple text and extended info
        questions = []
        questions_extended = []
        for item in data['questions']:
            questions.append(item["question"])  # For backward compatibility
            question_ext = {
                "question": item["question"],
                "domain": item["domain"]
            }
            if "practice" in item:
                question_ext["practice"] = item["practice"]
            questions_extended.append(question_ext)

        unique_domains = list({item["domain"] for item in data['questions']})
        
        # Get practice course if it exists, removing .json extension if present
        practice_source = None
        if 'practice_source' in data and len(data['practice_source']) > 0:
            practice_source = data['practice_source'][0]
            if practice_source.endswith('.json'):
                practice_source = practice_source[:-5]

        # Return the ProfilerType with both question formats
        response = {
            "name": profiler_type.name,
            "filename": profiler_type.filename,
            "questions": questions,  # Original format for backward compatibility
            "questions_extended": questions_extended,  # New format with additional data
            "answerOptions": data['answerOptions'],
            "domains": unique_domains,
            "practiceSource": practice_source
        }
        return response

@api_router.get("/groups", tags=["groups"],
    summary="List All Groups",
    description="""
    Retrieve all groups with their profile counts.
    Optionally include archived groups in the results.
    Requires teacher authentication.
    """,
    responses={
        200: {"description": "List of groups retrieved successfully"},
        401: {"description": "Unauthorized - Teacher authentication required"}
    })
def read_all_groups(
    includeArchived: bool = Query(default=False, description="Include archived groups in the results"),
    user=Depends(current_user_valid_pw)
):
    with SessionLocal() as db:
        query = db.query(
            Group,
            func.count(Profile.id).label("profile_count")
        ).outerjoin(
            Profile, (Group.name == Profile.groupName) & (Profile.status == "Complete")
        )

        if not includeArchived:
            query = query.filter(Group.archived == False)

        groups = query.group_by(Group.name).order_by(Group.name).all()

        return [
            {
                "name": group.name,
                "displayAs": group.displayAs,
                "archived": group.archived,
                "profile_count": profile_count,
                "emoji": group.emoji,
                "token": group.token,
                "profilerTypeName": group.profilerTypeName
            }
            for group, profile_count in groups
        ]

@api_router.get("/groups/{group_name}", tags=["groups"],
    summary="Get Group Details",
    description="""
    Retrieve detailed information about a specific group including:
    - Group metadata (name, display name, emoji)
    - Profile list with scores
    - Aggregated domain scores across all profiles
    - Practice recommendations based on group scores
    Requires teacher authentication.
    """,
    responses={
        200: {"description": "Group details retrieved successfully"},
        401: {"description": "Unauthorized - Teacher authentication required"},
        404: {"description": "Group not found"}
    })
def read_group(
    group_name: str = Path(..., description="The name of the group to retrieve"),
    user=Depends(current_user_valid_pw)
):
    with SessionLocal() as db:
        group = db.query(Group).filter(Group.name == group_name).first()
        if not group:
            raise HTTPException(status_code=404, detail="Group not found")

        # Fetch all profiles for the group where status is 'Complete'
        profiles = db.query(Profile).filter(
            (Profile.groupName == group_name) & (Profile.status == "Complete")
        ).all()

        print(f"Found {len(profiles)} completed profiles for group {group_name}")

        # Count the number of profiles
        profile_count = len(profiles)

        # For each profile, aggregate scores by domain
        profile_data = []
        aggregated_domain_scores = {}
        aggregated_question_scores = {}

        for profile in profiles:
            # Get all answers for this profile
            answers = (
                db.query(Answer)
                .filter(Answer.profileId == profile.id)
                .all()
            )

            print(f"Found {len(answers)} answers for profile {profile.id}")

            # Aggregate domain scores for this profile
            domain_scores = {}
            for answer in answers:
                # Add to profile's domain scores
                domain_scores[answer.domain] = domain_scores.get(answer.domain, 0) + answer.score
                
                # Add to group's aggregated domain scores
                aggregated_domain_scores[answer.domain] = aggregated_domain_scores.get(answer.domain, 0) + answer.score
                
                # Add to aggregated question scores
                if answer.question not in aggregated_question_scores:
                    aggregated_question_scores[answer.question] = {
                        'total_score': 0,
                        'count': 0,
                        'domain': answer.domain
                    }
                aggregated_question_scores[answer.question]['total_score'] += answer.score
                aggregated_question_scores[answer.question]['count'] += 1

            # Append profile data
            profile_data.append({
                "id": profile.id,
                "name": profile.name,
                "domain_scores": domain_scores,
            })

        print(f"Aggregated domain scores: {aggregated_domain_scores}")

        practice_recommendations = []
        if profile_count > 0 and len(profiles) > 0:
            # Get the profiler type from the first profile
            first_profile = profiles[0]
            profiler_type = db.query(ProfilerType).filter(ProfilerType.name == first_profile.profilerTypeName).first()
            
            print(f"Using profiler type: {profiler_type.name} from file {profiler_type.filename}")
            
            if profiler_type and profiler_type.filename:
                try:
                    # Read the profiler file to get question mappings
                    with open(f"/app/api/profilers/{profiler_type.filename}", "r") as file:
                        profiler_data = json.load(file)
                    
                    print(f"Loaded profiler data from {profiler_type.filename}")
                    
                    # Map questions to their practices
                    practice_scores = {}
                    for question in profiler_data.get('questions', []):
                        if 'practice' in question:
                            # Get practice IDs (could be string or array)
                            practice_ids = question['practice'] if isinstance(question['practice'], list) else [question['practice']]
                            print(f"Question '{question['question']}' maps to practices: {practice_ids}")
                            
                            # Get average score for this question
                            if question['question'] in aggregated_question_scores:
                                q_score = aggregated_question_scores[question['question']]
                                avg_score = q_score['total_score'] / q_score['count']
                                
                                # Add score to each associated practice
                                for practice_id in practice_ids:
                                    if practice_id not in practice_scores:
                                        practice_scores[practice_id] = {
                                            'total_score': 0,
                                            'count': 0
                                        }
                                    practice_scores[practice_id]['total_score'] += q_score['total_score']
                                    practice_scores[practice_id]['count'] += 1

                    print(f"Calculated practice scores: {practice_scores}")
                    
                    # Get practice source file
                    practice_source = None
                    if 'practice_source' in profiler_data and len(profiler_data['practice_source']) > 0:
                        practice_source = profiler_data['practice_source'][0]
                        if practice_source.endswith('.json'):
                            practice_source = practice_source[:-5]
                        
                        print(f"Using practice source: {practice_source}")
                        
                        # Read the practice data
                        practice_file_path = f"/app/api/practice/{practice_source}.json"
                        print(f"Loading practice data from: {practice_file_path}")
                        
                        with open(practice_file_path, "r") as file:
                            practice_data = json.load(file)
                        
                        print(f"Successfully loaded practice data")
                        
                        # Find and sort practices
                        for category in practice_data:
                            for subcategory in category.get('children', []):
                                # Use the subcategory ID directly since it already includes the category prefix
                                practice_id = subcategory['id']
                                if practice_id in practice_scores:
                                    score_data = practice_scores[practice_id]
                                    if score_data['count'] > 0:
                                        # Use total score instead of average
                                        total_score = score_data['total_score']
                                        recommendation = {
                                            'id': practice_id,
                                            'name': subcategory['name'],
                                            'score': round(total_score),
                                            'categories': [category['name']],  # Only include parent category
                                            'strategies': [child.get('text') for child in subcategory.get('children', [])]
                                        }
                                        practice_recommendations.append(recommendation)
                                        print(f"Added recommendation for {practice_id} with score {total_score}")

                        # Sort recommendations by score
                        practice_recommendations.sort(key=lambda x: x['score'], reverse=True)
                        print(f"Generated {len(practice_recommendations)} practice recommendations")

                except (FileNotFoundError, json.JSONDecodeError, KeyError) as e:
                    print(f"Error processing practice recommendations: {str(e)}")
                    # Continue without practice recommendations if there's an error
                    pass

        return {
            "name": group.name,
            "displayAs": group.displayAs,
            "emoji": group.emoji,
            "archived": group.archived,
            "profile_count": profile_count,
            "token": group.token,
            "profiles": profile_data,
            "aggregated_domain_scores": aggregated_domain_scores,
            "practice_recommendations": practice_recommendations
        }
    
class GroupCreate(BaseModel):
    name: str
    displayAs: str
    profilerTypeName: str
    emoji: Optional[str] = None

@api_router.post("/groups", tags=["groups"],
    summary="Create New Group",
    description="""
    Create a new group with the specified name, display name, and profiler type.
    An emoji can optionally be provided, defaulting to 🧠 if not specified.
    Requires teacher authentication.
    """,
    responses={
        200: {"description": "Group created successfully"},
        400: {"description": "Bad request - Group already exists or invalid emoji"},
        401: {"description": "Unauthorized - Teacher authentication required"},
        500: {"description": "Internal server error while creating group"}
    })
async def create_group(
    group: GroupCreate = Body(..., description="The group details"), 
    user=Depends(current_user_valid_pw)
):
    if group.emoji:
        if not is_single_emoji(group.emoji):
            raise HTTPException(status_code=400, detail="Invalid emoji. Please provide a single valid emoji.")
    else:
        group.emoji = "🧠"  # Default emoji

    with SessionLocal() as db:
        try:
            # Start a transaction
            db.begin()

            # Check for duplicate names
            existing_group = db.query(Group).filter(Group.name == group.name).first()
            if existing_group:
                raise HTTPException(status_code=400, detail="A group with this name already exists")

            new_group = Group(
                name=group.name,
                displayAs=group.displayAs,
                profilerTypeName=group.profilerTypeName,
                emoji=group.emoji,
                token=str(uuid.uuid4()),
                archived=False,
                hasProfiles=False
            )
            db.add(new_group)
            db.commit()
            db.refresh(new_group)
            return new_group

        except Exception as e:
            # Rollback on any error
            db.rollback()
            if isinstance(e, HTTPException):
                raise e
            raise HTTPException(status_code=500, detail="An error occurred while creating the group")

class GroupUpdate(BaseModel):
    name: Optional[str] = None
    displayAs: Optional[str] = None
    archived: Optional[bool] = None
    emoji: Optional[str] = None

@api_router.put("/groups/{group_name}", tags=["groups"],
    summary="Update Group",
    description="""
    Update an existing group's properties including name, display name,
    archived status, and emoji. Requires teacher authentication.
    When updating the group name, all related profiles will be updated accordingly.
    """,
    responses={
        200: {"description": "Group updated successfully"},
        400: {"description": "Bad request - Group name already exists or invalid emoji"},
        401: {"description": "Unauthorized - Teacher authentication required"},
        404: {"description": "Group not found"},
        500: {"description": "Internal server error while updating group"}
    })
def update_group(
    group_name: str = Path(..., description="The current name of the group"),
    group: GroupUpdate = Body(..., description="The updated group details"),
    user=Depends(current_user_valid_pw)
):
    with SessionLocal() as db:
        try:
            # Start a transaction
            db.begin()
            
            # Get existing group
            existing_group = db.query(Group).filter(Group.name == group_name).first()
            if not existing_group:
                raise HTTPException(status_code=404, detail="Group not found")
            
            # If name is being updated, check for duplicates and update related records
            if group.name is not None and group.name != group_name:
                # Check for duplicate names
                duplicate = db.query(Group).filter(Group.name == group.name).first()
                if duplicate:
                    raise HTTPException(status_code=400, detail="A group with this name already exists")
                
                # Update related profiles
                db.query(Profile).filter(Profile.groupName == group_name).update(
                    {"groupName": group.name}
                )
                
                # Update the group name
                existing_group.name = group.name

            # Update other fields if provided
            if group.displayAs is not None:
                existing_group.displayAs = group.displayAs
            if group.archived is not None:
                existing_group.archived = group.archived
            if group.emoji is not None:
                if not is_single_emoji(group.emoji):
                    raise HTTPException(status_code=400, detail="Invalid emoji. Please provide a single valid emoji.")
                existing_group.emoji = group.emoji

            # Commit all changes
            db.commit()
            return existing_group
            
        except Exception as e:
            # Rollback on any error
            db.rollback()
            if isinstance(e, HTTPException):
                raise e
            raise HTTPException(status_code=500, detail="An error occurred while updating the group")

@api_router.post("/groups/{group_name}/regenerate-token", tags=["groups"],
    summary="Regenerate Group Token",
    description="""
    Generate a new token for the group, invalidating the old one.
    This will prevent new profiles from being created with the old token.
    Requires teacher authentication.
    """,
    responses={
        200: {"description": "Token regenerated successfully"},
        401: {"description": "Unauthorized - Teacher authentication required"},
        404: {"description": "Group not found"}
    })
def regenerate_group_token(
    group_name: str = Path(..., description="The name of the group"),
    user=Depends(current_user_valid_pw)
):
    with SessionLocal() as db:
        group = db.query(Group).filter(Group.name == group_name).first()
        if not group:
            raise HTTPException(status_code=404, detail="Group not found")
        
        group.token = str(uuid.uuid4())
        db.commit()
        db.refresh(group)
        return group

@api_router.delete("/groups/{group_name}", tags=["groups"],
    summary="Delete Group",
    description="""
    Permanently delete a group.
    This action cannot be undone and will orphan any associated profiles.
    Requires teacher authentication.
    """,
    responses={
        204: {"description": "Group deleted successfully"},
        401: {"description": "Unauthorized - Teacher authentication required"},
        404: {"description": "Group not found"}
    })
async def delete_group(
    group_name: str = Path(..., description="The name of the group to delete"),
    user=Depends(current_user_valid_pw)
):
    with SessionLocal() as db:
        group = db.query(Group).filter(Group.name == group_name).first()
        if not group:
            raise HTTPException(status_code=404, detail="Group not found")
        db.delete(group)
        db.commit()

class UserResponse(BaseModel):
    id: str
    email: str
    is_active: bool
    is_verified: bool
    is_superuser: bool
    changePasswordOnLogin: bool

class CreateUserResponse(UserResponse):
    password: str

@app.get("/users", response_model=List[UserResponse], tags=["users"])
async def get_all_users(
    user: User = Depends(current_superuser_valid_pw)
):
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User))
        users = result.scalars().all()
        #users = result.fetchall()
    return [UserResponse(
            id=str(u.id),
            email=u.email,
            is_active=u.is_active,
            is_verified=u.is_verified,
            is_superuser=u.is_superuser,
            changePasswordOnLogin=u.changePasswordOnLogin
        ) for u in users]

class CreateUserRequest(BaseModel):
    email: str
    is_superuser: bool

@app.put("/users", response_model=CreateUserResponse, tags=["users"])
async def create_user(
    user_request: CreateUserRequest,
    user: User = Depends(current_superuser_valid_pw)
):
    """
    Create a new user with a random password. Only superusers can create new users.
    """
    # Generate random 8-char password with letters and digits
    password = ''.join(random.choices(string.ascii_letters + string.digits, k=8))
    
    try:
        result = await SuperCreateUser(
            email=user_request.email,
            password=password,
            is_superuser=user_request.is_superuser
        )
        
        return {
            "id": result['id'],
            "email": result['email'],
            "is_active": result['is_active'],
            "is_verified": result['is_verified'],
            "is_superuser": result['is_superuser'],
            "changePasswordOnLogin": result['changePasswordOnLogin'],
            "password": result['password']
        }
    except UserAlreadyExists:
        raise HTTPException(
            status_code=400,
            detail="A user with this email already exists"
        )

@app.put("/users/{user_id}/reset-password", response_model=CreateUserResponse, tags=["users"])
async def reset_user_password(
    user_id: str,
    user: User = Depends(current_superuser_valid_pw)
):
    """
    Reset a user's password to a new random password. Only superusers can reset passwords.
    The user will be required to change their password on next login.
    """
    # Generate random 8-char password with letters and digits
    password = ''.join(random.choices(string.ascii_letters + string.digits, k=8))
    
    async with AsyncSessionLocal() as db:
        # Find the user
        result = await db.execute(select(User).filter(User.id == uuid.UUID(user_id)))
        target_user = result.scalars().first()
        if not target_user:
            raise HTTPException(status_code=404, detail="User not found")
            
        async with get_user_manager_context(SQLAlchemyUserDatabase(db, User)) as user_manager:
            # Hash the password and create update dict
            hashed_password = user_manager.password_helper.hash(password)
            update_dict = {"hashed_password": hashed_password}
            
            # Update the password hash directly
            await db.execute(
                update(User)
                .where(User.id == target_user.id)
                .values(**update_dict)
            )
            
            # Set changePasswordOnLogin flag
            await db.execute(
                update(User)
                .where(User.id == target_user.id)
                .values(changePasswordOnLogin=True)
            )
            
            await db.commit()
            await db.refresh(target_user)
            
        return {
            "id": str(target_user.id),
            "email": target_user.email,
            "is_active": target_user.is_active,
            "is_verified": target_user.is_verified,
            "is_superuser": target_user.is_superuser,
            "changePasswordOnLogin": True,
            "password": password
        }

class ConfigurationRequest(BaseModel):
    key: str
    value: str
    write_only: Optional[bool] = False
    superuser_only: Optional[bool] = False

@api_router.put("/config", tags=["configurations"],
    summary="Set Configuration Value",
    description="""
    Set a global configuration key-value pair with optional flags:
    - write_only: If true, the value cannot be read back
    - superuser_only: If true, only superusers can access the value
    Requires superuser authentication.
    """,
    responses={
        200: {"description": "Configuration set successfully"},
        401: {"description": "Unauthorized - Superuser authentication required"}
    })
def set_configuration(
    config_request: ConfigurationRequest = Body(..., description="The configuration details"),
    user=Depends(current_superuser_valid_pw)
):
    with SessionLocal() as db:
        # Check if the key already exists
        config = db.query(Configuration).filter(Configuration.key == config_request.key).first()
        if config:
            # Update the existing value and flags
            config.value = config_request.value
            config.write_only = config_request.write_only
            config.superuser_only = config_request.superuser_only
        else:
            # Create a new configuration entry
            config = Configuration(
                key=config_request.key,
                value=config_request.value,
                write_only=config_request.write_only,
                superuser_only=config_request.superuser_only
            )
            db.add(config)
        db.commit()
        return {
            "key": config.key,
            "write_only": config.write_only,
            "superuser_only": config.superuser_only
        }

@api_router.get("/config/{key}", tags=["configurations"],
    summary="Get Configuration Value",
    description="""
    Retrieve the value of a global configuration key.
    - Returns 405 if the key is write-only
    - Returns 403 if the key is superuser-only and user is not a superuser
    Requires teacher authentication.
    """,
    responses={
        200: {"description": "Configuration value retrieved successfully"},
        401: {"description": "Unauthorized - Teacher authentication required"},
        403: {"description": "Forbidden - Superuser required for this key"},
        404: {"description": "Configuration key not found"},
        405: {"description": "Method not allowed - Write-only key"}
    })
def get_configuration(
    key: str = Path(..., description="The configuration key to retrieve"),
    user=Depends(current_user_valid_pw)
):
    with SessionLocal() as db:
        # Check if the key exists
        config = db.query(Configuration).filter(Configuration.key == key).first()
        if not config:
            raise HTTPException(status_code=404, detail="Configuration key not found")
        
        # Check if the key is write-only
        if config.write_only:
            raise HTTPException(status_code=405, detail="Configuration key exists but cannot be read (write-only).")
        
        # Check if the key is superuser-only
        if config.superuser_only and not user.is_superuser:
            raise HTTPException(status_code=403, detail="Not authorised to access this configuration key.")
        
        # Return the key and value
        return {"key": config.key, "value": config.value}

@api_router.get("/practices/{filename}", tags=["practices"],
    summary="Get Practice File",
    description="""
    Retrieve the contents of a practice file by filename.
    The .json extension is optional in the filename.
    Requires teacher authentication.
    """,
    responses={
        200: {"description": "Practice file retrieved successfully"},
        400: {"description": "Invalid filename"},
        401: {"description": "Unauthorized - Teacher authentication required"},
        404: {"description": "Practice file not found"},
        500: {"description": "Error decoding practice file"}
    })
def get_practice(
    filename: str = Path(..., description="The name of the practice file (with or without .json extension)"),
    user=Depends(current_user_valid_pw)
):
    # Add .json extension if not present
    if not filename.endswith('.json'):
        filename = f"{filename}.json"
        
    # Sanitize path to prevent directory traversal
    safe_path = os.path.abspath(os.path.join(PRACTICE_DIR, filename))
    if not safe_path.startswith(os.path.abspath(PRACTICE_DIR)):
        raise HTTPException(status_code=400, detail="Invalid filename")
        
    try:
        with open(safe_path, "r") as file:
            data = json.load(file)
            return data
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Practice file not found")
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Error decoding practice file")

# the API router at /api
app.include_router(api_router, prefix="/api")

# Auth routes from fastapi-users
app.include_router(
    fastapi_users.get_auth_router(auth_backend), prefix="/auth/jwt", tags=["auth"]
)
app.include_router(
    fastapi_users.get_users_router(UserRead, UserUpdate),
    prefix="/users",
    tags=["users"],
)

